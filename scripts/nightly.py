#!/usr/bin/env python3
import argparse
import json
import os
import random
import sys
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

try:
    from zoneinfo import ZoneInfo
except Exception:
    ZoneInfo = None


NIGHTLY_TEXT = (
    "Nightly pass. No user present. Review today. Write diary if anything mattered. "
    "Stay silent unless you want to send one short message."
)

START_MINUTE = 22 * 60 + 20
END_MINUTE = 22 * 60 + 50


def main():
    parser = argparse.ArgumentParser(description="Queue Cyberboss nightly self-review system messages.")
    parser.add_argument("--once", action="store_true", help="Queue one nightly message immediately and exit.")
    args = parser.parse_args()

    state_dir = Path(read_env_file("CYBERBOSS_STATE_DIR") or Path.home() / ".cyberboss")
    while True:
      try:
          if args.once:
              queued = queue_nightly_message(state_dir)
              print(f"[cyberboss] nightly queued id={queued['id']}", flush=True)
              return

          run_at = next_run_time(now_local())
          delay_seconds = max(0, (run_at - now_local()).total_seconds())
          print(f"[cyberboss] next nightly pass at {run_at.strftime('%Y-%m-%d %H:%M:%S %z')}", flush=True)
          time.sleep(delay_seconds)

          queued = queue_nightly_message(state_dir)
          print(f"[cyberboss] nightly queued id={queued['id']}", flush=True)
      except KeyboardInterrupt:
          return
      except Exception as error:
          print(f"[cyberboss] nightly error: {error}", file=sys.stderr, flush=True)
          time.sleep(300)


def queue_nightly_message(state_dir):
    target = resolve_target(state_dir)
    queue_file = state_dir / "system-message-queue.json"
    state_file = state_dir / "nightly-state.json"
    today = now_local().strftime("%Y-%m-%d")

    state = read_json(state_file, {})
    if state.get("lastQueuedDate") == today:
        raise RuntimeError(f"nightly already queued for {today}")

    message = {
        "id": str(uuid.uuid4()),
        "accountId": target["accountId"],
        "senderId": target["senderId"],
        "workspaceRoot": target["workspaceRoot"],
        "text": NIGHTLY_TEXT,
        "createdAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "attempts": 0,
        "nextAttemptAt": "",
        "lastError": "",
    }

    queue = read_json(queue_file, {"messages": []})
    messages = queue.get("messages")
    if not isinstance(messages, list):
        messages = []
    messages.append(message)
    messages.sort(key=lambda item: (str(item.get("createdAt") or ""), str(item.get("id") or "")))
    write_json(queue_file, {"messages": messages})
    write_json(state_file, {
        "lastQueuedDate": today,
        "lastQueuedAt": message["createdAt"],
        "lastMessageId": message["id"],
    })
    return message


def resolve_target(state_dir):
    account_id = first_text(
        read_env_file("CYBERBOSS_ACCOUNT_ID"),
        resolve_current_account_id(state_dir),
    )
    if not account_id:
        raise RuntimeError("cannot determine accountId; set CYBERBOSS_ACCOUNT_ID or log in once")

    sessions = read_json(state_dir / "sessions.json", {})
    bindings = [
        value for value in (sessions.get("bindings") or {}).values()
        if isinstance(value, dict) and text(value.get("accountId")) == account_id
    ]
    bindings.sort(key=lambda item: parse_timestamp(item.get("updatedAt")), reverse=True)

    sender_id = first_text(
        read_env_file("CYBERBOSS_NIGHTLY_USER_ID"),
        read_env_file("CYBERBOSS_CHECKIN_USER_ID"),
        read_env_file("CYBERBOSS_ALLOWED_USER_IDS").split(",")[0] if read_env_file("CYBERBOSS_ALLOWED_USER_IDS") else "",
        bindings[0].get("senderId") if bindings else "",
        single_context_token_user(state_dir, account_id),
    )
    if not sender_id:
        raise RuntimeError("cannot determine senderId; let the user talk once or set CYBERBOSS_NIGHTLY_USER_ID")

    workspace_root = first_text(
        read_env_file("CYBERBOSS_NIGHTLY_WORKSPACE"),
        read_env_file("CYBERBOSS_CHECKIN_WORKSPACE"),
        read_env_file("CYBERBOSS_WORKSPACE_ROOT"),
        active_workspace_for_sender(bindings, sender_id),
        os.getcwd(),
    )
    if not workspace_root or not Path(workspace_root).is_dir():
        raise RuntimeError(f"cannot determine workspaceRoot: {workspace_root}")

    return {
        "accountId": account_id,
        "senderId": sender_id,
        "workspaceRoot": str(Path(workspace_root).resolve()),
    }


def resolve_current_account_id(state_dir):
    accounts_dir = state_dir / "accounts"
    if not accounts_dir.is_dir():
        return ""
    entries = []
    for path in accounts_dir.glob("*.json"):
        if path.name.endswith(".context-tokens.json"):
            continue
        parsed = read_json(path, {})
        account_id = text(parsed.get("accountId"))
        if account_id:
            entries.append((parse_timestamp(parsed.get("savedAt")), account_id))
    entries.sort(reverse=True)
    return entries[0][1] if entries else ""


def single_context_token_user(state_dir, account_id):
    token_file = state_dir / "accounts" / f"{account_id}.context-tokens.json"
    parsed = read_json(token_file, {})
    users = [text(key) for key in parsed.keys() if text(key)]
    return users[0] if len(users) == 1 else ""


def active_workspace_for_sender(bindings, sender_id):
    for binding in bindings:
        if text(binding.get("senderId")) != sender_id:
            continue
        active = text(binding.get("activeWorkspaceRoot"))
        if active:
            return active
    return ""


def next_run_time(now):
    minute = random.randint(START_MINUTE, END_MINUTE)
    candidate = now.replace(hour=minute // 60, minute=minute % 60, second=0, microsecond=0)
    if candidate <= now:
        candidate = candidate + timedelta(days=1)
    return candidate


def now_local():
    if ZoneInfo:
        try:
            return datetime.now(ZoneInfo("Asia/Shanghai"))
        except Exception:
            pass
    return datetime.now(timezone(timedelta(hours=8)))


def read_json(path, fallback):
    try:
        with open(path, "r", encoding="utf-8") as handle:
            parsed = json.load(handle)
        return parsed if isinstance(parsed, dict) else fallback
    except Exception:
        return fallback


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_suffix(path.suffix + ".tmp")
    with open(tmp_path, "w", encoding="utf-8") as handle:
        json.dump(value, handle, ensure_ascii=False, indent=2)
    os.replace(tmp_path, path)


def read_env_file(name):
    value = os.environ.get(name, "").strip()
    if value:
        return value
    for env_path in (Path.cwd() / ".env", Path.home() / ".cyberboss" / ".env"):
        parsed = read_simple_env(env_path)
        if name in parsed and parsed[name].strip():
            return parsed[name].strip()
    return ""


def read_simple_env(path):
    values = {}
    try:
        for raw_line in path.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            values[key.strip()] = value.strip().strip('"').strip("'")
    except Exception:
        pass
    return values


def parse_timestamp(value):
    normalized = text(value).replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(normalized).timestamp()
    except Exception:
        return 0


def first_text(*values):
    for value in values:
        normalized = text(value)
        if normalized:
            return normalized
    return ""


def text(value):
    return value.strip() if isinstance(value, str) else ""


if __name__ == "__main__":
    main()
