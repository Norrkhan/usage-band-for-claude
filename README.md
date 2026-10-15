# usage-band-for-claude

A Claude Code mod that shows a live, colour-coded usage line right above the prompt:

```
◆ opus-5-5 ⚡high ultracode off   ctx █████░░░░░░░░░░░░░░░ 23% 45k/200k   5h ▰▰▰▰▱▱▱▱▱▱ 42% ↻ 2h13m   7d ▰▱▱▱▱▱▱▱▱▱ 12% ↻ 3d4h   ⏱ 25m
```

- **Model** in use.
- **⚡ Effort** of the latest request, coloured by level (low → max).
- **Ultracode**: a highlighted badge when it's on for the session or for one prompt.
- **ctx**: a progress bar of how full the context window is, with tokens used.
- **5h / 7d**: how much of your usage limits you've used, and when each resets (↻).
- **⏱** how long the session has been running.

Bars and percentages turn green → yellow (60%) → red (85%). Colours follow your Claude Code theme, and the bars shrink on narrow terminals. The 5h/7d limits show on a Claude subscription after the first reply of a session.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install usage-band-for-claude --marketplace Norrkhan/usage-band-for-claude
```

Answer `y` to add the marketplace, then pick a scope (user scope shows it in every session).

From a shell:

```
claude plugin install usage-band-for-claude --marketplace Norrkhan/usage-band-for-claude
```

In the desktop app: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `Norrkhan/usage-band-for-claude`, then **Add plugin**.

Collapse the line with `[-]` or `ctrl+x ctrl+a`.

## License

[MIT](LICENSE)
