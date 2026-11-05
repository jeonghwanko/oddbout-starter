# oddbout

Connect your coding agent to [ODDBOUT](https://oddbout.com)'s hosted MCP in one line. Paste this into Claude Code, Codex or Gemini CLI:

> Connect ODDBOUT: run `npx -y oddbout@latest connect` and follow what it prints.

Your agent runs the command and follows its reply. You approve the Google sign-in once, in your browser. The command then:

1. Finds the agent it runs in (or asks which one, through its reply).
2. Adds ODDBOUT's MCP server, `oddbout` at `https://mcp.oddbout.com/signin`, with the agent's own command
   (`claude mcp add`, `codex mcp add`, `gemini mcp add`). If the agent already has an ODDBOUT server, it uses that one instead.
3. Starts the sign-in where the agent allows it:
   - **Codex**: `codex mcp add` opens your browser by itself.
   - **Claude Code**: one step is yours. Claude Code signs in only with a terminal attached, and an agent's command has none, so the reply
     asks you to type `/mcp`, choose `oddbout`, then Authenticate. When you run the command yourself in a terminal, it runs
     `claude mcp login oddbout` there and your browser opens.
   - **Gemini CLI**: restart it, then type `/mcp auth oddbout`.
4. Installs the `create-fighter` skill in Codex and Claude Code (skills only: no second MCP server).
5. Tells your agent to confirm with ODDBOUT's `get_profile` that it reaches your account.

You can run it again at any time: what is already there is left as it is. `npx -y oddbout@latest check` reports the state and changes nothing.

## What it never does

- It never sees, asks for or writes a token or API key. The agent's own MCP client signs in (OAuth with dynamic client registration and
  PKCE against ODDBOUT's sign-in), and stores what it gets the way it always does.
- It never removes, renames or edits an MCP server you already have. If another server already uses the name `oddbout`, it tells you and
  offers another name.
- Connecting does not create, generate or register a fighter.

Never paste a sign-in link's callback address, a code or a token into a chat.

## Options

```
npx -y oddbout@latest connect [--host claude|codex|gemini] [--name <name>] [--no-skill] [--wait <seconds>] [--local|--remote]
npx -y oddbout@latest check   [--host claude|codex|gemini]
```

`--wait` (default 110 seconds) is how long it waits for you to finish signing in, short enough for an agent's default command timeout; if
time runs out, run it again.

## The reply

stdout carries one JSON object for the agent:

| Field | Meaning |
| --- | --- |
| `status` | `connected`, `registered` (added, sign-in not checkable here), `sign-in-needed`, `sign-in-pending`, `needs-permission`, `conflict`, `not-connected`, `choose-host` or `failed` |
| `next` | What the agent does next: `verify`, `rerun`, `user-signs-in`, `ask-user` or `stop` |
| `say` | What to tell you |
| `run` | The next command, when `next` is `rerun` |
| `verify` | The confirming tool call (`get_profile`) and how to load new tools into the running session |
| `rules` | What the agent must not do (never handle tokens or callback addresses in chat, never remove your servers) |
| `details` | What it found and every command it ran |

## Over SSH or in a container

A browser on your computer cannot hand the sign-in back to another machine. The reply then tells you to run the agent's own login there with
`--no-browser` (in a terminal, `ssh -t`): `claude mcp login oddbout --no-browser` or `codex mcp login oddbout --no-browser`. Open the printed
link on your computer, sign in, and paste the address your browser ends on only into that terminal prompt.

## After connecting

Agents load new MCP servers when a session starts. In Claude Code, type `/mcp` and reconnect `oddbout`, or exit and run `claude --continue`;
`/reload-plugins` loads the skill. In Codex, run `codex resume --last`. Then ask the agent to check your ODDBOUT account.

Source and docs: [oddbout-starter](https://github.com/jeonghwanko/oddbout-starter/tree/main/packages/oddbout) ·
[connection guide](https://github.com/jeonghwanko/oddbout-starter/blob/main/docs/CLOUD-MCP.md). MIT license.
