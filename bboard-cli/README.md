# bboard-cli

VeilCore's operator CLI. How to run it, step by step, is in
[docs/runbook.md](../docs/runbook.md).

## Private state

The CLI keeps its private state (the record secret it acts as) per network in
`~/.veilcore/<network>/private-state`, readable only by your user account.

**One CLI per store.** Two CLIs on the same store each write back the private state they
read when a call started, so one can silently overwrite the other's. While a CLI runs it
holds a lock file next to the store, `~/.veilcore/<network>/private-state.lock`, with its
process id and computer name. A second CLI on that store is refused before it asks for
anything, with a message naming the process that holds it. The lock is removed when the
CLI exits.

**A stale lock.** If the process named in the lock has gone (killed, crashed, the
computer restarted), the next run takes the lock over by itself. A lock written on
another computer, or one that cannot be read, is refused rather than guessed at. If you
are sure no CLI is using the store, delete the file
(`rm ~/.veilcore/<network>/private-state.lock`) and start again. Do not delete it while a
CLI is running.
