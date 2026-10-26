# Multiple Claude accounts

Feature ID: `claude-multi-account`. Keep the behavior across repeated upstream rebases rather than preserving a commit hash.

The personal fork can run Claude Code conversations with more than one Claude subscription on the same computer, for example a company Team account and a personal Max account. Each account is a separate Claude Code configuration folder (`CLAUDE_CONFIG_DIR`), so logins, transcripts, and usage limits stay separate.

With a single account nothing changes: no account selector, number badge, or extra usage entry appears, and conversations start exactly as before. Everything below applies only after a second account is registered.

## How it works

- **The default account is the default Claude folder**: the `CLAUDE_CONFIG_DIR` that AionUi was started with, otherwise `~/.claude`. Every extra account points at another folder. Conversations that do not name an account use the default account.
- **The account is chosen when a conversation is created and cannot be changed afterwards.** Claude stores the transcript inside the account folder, so switching accounts would break resume. When one account hits its limit, start a new conversation with another account.
- **Account numbers follow the account order in settings.** AionUi and MindNProgress show the same number for the same account. The default account is number 1 until you reorder it.

## 1. Prepare and log in the extra account

Create an empty folder and log in once with `CLAUDE_CONFIG_DIR` pointing at it. AionUi only accepts a folder that already exists.

Windows PowerShell:

```powershell
New-Item -ItemType Directory -Force "$HOME\.claude-max" | Out-Null
$env:CLAUDE_CONFIG_DIR = "$HOME\.claude-max"
claude auth login
claude auth status
Remove-Item Env:CLAUDE_CONFIG_DIR
```

The last line matters. While the variable is set, every `claude` started from that PowerShell window uses the extra account. If PowerShell cannot find `claude`, use the full path of the native installer, `~\.local\bin\claude.exe`.

macOS / Linux:

```bash
mkdir -p ~/.claude-max
CLAUDE_CONFIG_DIR="$HOME/.claude-max" claude auth login
CLAUDE_CONFIG_DIR="$HOME/.claude-max" claude auth status
```

`claude auth status` should report `"loggedIn": true` and the plan in `subscriptionType`, for example `max` or `team`.

**Optional: a terminal shortcut.** Use this to run the extra account directly in a terminal. It also loads the default account's `settings.json`, which is the same thing AionUi's share option does.

```powershell
# PowerShell profile
function claude-max {
  $previous = $env:CLAUDE_CONFIG_DIR
  $env:CLAUDE_CONFIG_DIR = "$HOME\.claude-max"
  try { claude --settings "$HOME\.claude\settings.json" @args }
  finally {
    if ($null -eq $previous) { Remove-Item Env:CLAUDE_CONFIG_DIR -ErrorAction SilentlyContinue }
    else { $env:CLAUDE_CONFIG_DIR = $previous }
  }
}
```

```bash
# ~/.zshrc or ~/.bashrc
claude-max() { CLAUDE_CONFIG_DIR="$HOME/.claude-max" claude --settings "$HOME/.claude/settings.json" "$@"; }
```

## 2. Share guidance, skills, and settings

A new folder starts empty. Decide what the extra account should share with the default account.

| Item                                                                      | Shared automatically?                                                            | What to do                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `settings.json` (hooks, permissions, env)                                 | Yes, while **Also load the default account's settings.json** is on (the default) | Nothing. AionUi starts the account with `--settings <default folder>/settings.json`. These hooks run, but Claude's interactive `/hooks` menu does not list them; confirm them from the hook's own output.                                     |
| `CLAUDE.md` (global guidance)                                             | No                                                                               | Create `<extra folder>/CLAUDE.md` containing the single line `@~/.claude/CLAUDE.md`. The account then imports the original instead of keeping a copy.                                                                                         |
| `skills/`                                                                 | No                                                                               | Copy each skill folder from `~/.claude/skills` to `<extra folder>/skills`, and copy it again whenever the original changes. This includes skills installed by the MindNProgress Suite installer, which only installs into the default folder. |
| MCP servers registered with `claude mcp add` (`.claude.json`) and plugins | No                                                                               | Register them again for the extra account if you need them. MCP servers selected in AionUi for a conversation are passed by AionUi and work with every account.                                                                               |
| AionUi assistant rules and AionUi skills                                  | Yes                                                                              | Nothing. AionUi injects them into each conversation.                                                                                                                                                                                          |
| Login                                                                     | No                                                                               | Each folder keeps its own login (step 1).                                                                                                                                                                                                     |

## 3. Register the account in AionUi

1. Open **Settings → Agents → Local Agents** and click the **Claude Code** card or its **Edit** button.
2. Under **Claude accounts** at the bottom of the page, click **Add account**.
3. Fill in the dialog:
   - **Name of the current default account**: shown only when adding the first extra account, for example `Company Team`. If you leave it empty, the default account is named `Default`.
   - **Account name**: 1 to 60 characters, for example `Personal Max`. Names are free text and are not taken from the plan, so a second Team account can be called `Team B`.
   - **Claude config folder**: the absolute path of the existing folder from step 1. The default folder and a folder that is already registered are rejected.
   - **Also load the default account's settings.json (hooks, permissions)**: keep it on unless the account needs separate hooks and permissions.
4. Click **Check login** on the new row. It shows **Logged in (plan)**, or **Not logged in** together with a login command you can copy. That command is written for PowerShell; on macOS use the command from step 1.

In the account list you can rename an account inline, toggle settings sharing, reorder accounts with the arrows, and delete an extra account. The default account cannot be deleted.

## 4. Use the accounts

- **New conversation**: when Claude Code is selected, an account selector appears next to the model selector. It starts on the default account; a launch from MindNProgress preselects the account that MindNProgress chose.
- **Conversation list and header**: the Claude icon carries the account number, and the conversation header shows the number and name.
- **Usage indicator**: the titlebar shows the account with the highest usage, taking the higher of its 5-hour and weekly values. Ties go to the lower number. Hover to see every account. A new account shows **No usage data yet** until it has a conversation whose workspace still exists; usage is refreshed about every two minutes.
- **Reordering** renumbers accounts everywhere. AI author names that MindNProgress has already written (for example `Claude Code ②(Opus)`) keep the old number.
- **Deleting** an account is refused while any conversation still uses it. Deleting never removes the folder. When only the default account remains, AionUi behaves as a single-account install again.

## Limitations

- The browser WebUI usage indicator shows the default account only.
- Team mode and scheduled tasks do not offer an account selector.
- The cc-switch provider environment is applied to the default account only.
- An existing conversation cannot be moved to another account.

## Troubleshooting

| Symptom                                                                   | Cause and fix                                                                                                            |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| "Check the account name and use the absolute path of an existing folder." | The folder does not exist yet, the path is relative, or the name is empty or too long. Create the folder first (step 1). |
| "This config folder is already registered."                               | The folder belongs to another account. Each account needs its own folder.                                                |
| **Not logged in**                                                         | Log in as shown in step 1, then click **Check login** again.                                                             |
| The extra account lacks your rules or skills                              | Add the `CLAUDE.md` import line and copy the skills (step 2).                                                            |
| Hooks seem missing in `/hooks`                                            | Expected for shared settings; check the hook's output instead.                                                           |
| **No usage data yet**                                                     | Start a conversation with that account and wait for the next refresh.                                                    |

## For every upstream rebase

Accounts are stored in `claude-accounts.json` (`version: 1`) in the AionCore data directory, `<AionUi userData>/aionui` (for example `%APPDATA%\AionUi\aionui`; development builds use `AionUi-Dev`). The file exists only while two or more accounts are registered; there is no database migration, so an older AionCore ignores it. A conversation stores its account in `extra.claude_account_id`; the default account stores nothing. AionCore serves `/api/claude-accounts` (list, create, order, update, delete, auth status). When two or more accounts exist, it attaches `claude_accounts` to the Claude Code row of the managed agent list.

1. In AionCore, keep `crates/aionui-ai-agent/src/claude_accounts/`, its wiring in `aionui-app/src/fork_integrations.rs`, and the Claude branch of `session_agent.rs`. That branch resolves the account, sets `CLAUDE_CONFIG_DIR`, adds `--settings`, and skips cc-switch for non-default accounts. Also keep the guard in `aionui-conversation` that rejects changing `claude_account_id`, and the account field in external dispatch and launch.
2. In AionUi, keep `renderer/pages/conversation/platforms/acp/claudeAccounts/`, the per-account usage probe in `process/usage/claude/`, the publisher's `claudeAccounts` snapshot field, and the small hooks in the conversation row, the header, the new-conversation page, the titlebar usage pill, and the agent settings page.
3. Run the focused tests:

```powershell
bun run test tests/unit/renderer/pages/claudeAccounts tests/unit/process/usage/claude/claudeAccountUsage.test.ts tests/unit/renderer/layout/claudeUsageDisplay.test.ts tests/unit/renderer/layout/claudeRateLimit.test.ts
cargo test -p aionui-app --test claude_accounts_e2e
```

4. With two accounts registered, start a conversation on the extra account. Confirm the AionCore log line `claude account applied to spawn` and that the transcript appears under that account folder's `projects`. Then restart that conversation's runtime and confirm it still remembers the previous turn.
