The first-run download now works on Windows networks that block certificate revocation lookups. That is the whole
of this release.

## Install

```sh
# npm: ~840 kB launcher, fetches the ~155 MB runtime once on first launch
dsh plugin --profile web add dsh-status-bar-plugin

# release tarball: 155 MB, self-contained, nothing downloaded later
dsh plugin --profile web add https://github.com/wfz2006/dsh-status-bar/releases/latest/download/dsh-status-bar.tgz
```

## What was broken

0.2.6 made a stalled download visible and resumable, but on a machine whose network cannot reach the
certificate-revocation endpoints, the bundled Windows `curl` never got as far as a stalled transfer:

```
curl: (35) schannel: next InitializeSecurityContext failed: CRYPT_E_NO_REVOCATION_CHECK (0x80092012)
```

Schannel treats "I could not check revocation" as a fatal handshake error, so all three attempts failed in under
a second, the progress window reported a connection failure, and the runtime never arrived. An acceptance run of
the published 0.2.6 package reproduced it: three attempts, no bytes written, no capsule.

## What changed

- The Windows `curl` invocation now passes `--ssl-revoke-best-effort`: revocation is still checked, but a lookup
  that cannot be completed no longer aborts the handshake.
- `--ssl-revoke-best-effort` needs curl 7.70 or newer. On an older curl the option is rejected with exit code 2,
  so the downloader retries the same attempt without the flag instead of failing.
- A TLS failure that survives the flag (curl 35/51/60) is retried once through the Node backend, which validates
  against its own trust store rather than Schannel's; if both paths agree the network is unusable, the window
  keeps the real reason and the resumable `.part` file.
- `curlArgs()` is exported and covered by a test: the flag is present for Schannel, absent when explicitly
  disabled, absent for the non-Schannel build, and the resume headers (`--continue-at`, `If-Range`) are unchanged.

## Verification

- `npx eslint .` clean, `npx tsc --noEmit` clean, `vitest run --maxWorkers=1` **21 files / 190 tests** pass.
- The real asset now downloads again from this machine: an aborted 45-second run left **1.8 MiB** in
  `probe-curl-fixed.tgz.part` where 0.2.6 wrote 0 bytes. Throughput here is ~40 KiB/s, so a full 155 MB first run
  takes tens of minutes on this connection; the progress window shows that instead of pretending to be stuck.
- 0.2.6 itself shipped with the resumable downloader, the native progress window and the title banner; nothing in
  that behaviour changed here.

## Artifacts

| artifact | size | contents |
|:--|--:|:--|
| npm `dsh-status-bar-plugin@0.2.7` | 840 kB packed | `lib/`, `cordis.patch.yml`, `assets/`, `screenshots.json`, `README.md`, `LICENSE` |
| release `dsh-status-bar.tgz` | 155 MB | the same files plus `app/` and `electron/dist/` (Electron 44.8.0) |
| release `dsh-glass-plugin.tgz` | 155 MB | compatibility copy for the pre-rename URL |

Both assets are built by the `release-bundle` workflow against tag `v0.2.7`; the workflow refuses a tag whose
`packages/dsh-status-bar/package.json` version differs.

## Notes

- Windows 11 x64 for the companion and the native progress window; other platforms keep the log-only path.
- If a first run is interrupted, the next launch resumes from the verifiable byte offset instead of starting over.
- MIT licensed. The bundled Electron runtime keeps its own license files.
