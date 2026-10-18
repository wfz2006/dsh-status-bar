import { describe, expect, it } from 'vitest';
import { dshLinkFromArgs, launcherPidFromArgs } from '../apps/desktop/src/shared/launch';

const link = 'http://127.0.0.1:4321/?token=abc_DEF-123';

describe('dshLinkFromArgs', () => {
  it('accepts the launcher hand-off', () => {
    expect(dshLinkFromArgs(['glass.exe', `--dsh-link=${link}`])).toBe(link);
  });

  it('takes the last occurrence when the flag repeats', () => {
    const second = 'http://localhost:9/?token=second';
    expect(dshLinkFromArgs([`--dsh-link=${link}`, `--dsh-link=${second}`])).toBe(second);
  });

  it('ignores absent or unrelated arguments', () => {
    expect(dshLinkFromArgs(['glass.exe', '--desktop-optics'])).toBeUndefined();
    expect(dshLinkFromArgs([`--dsh-link=`])).toBeUndefined();
  });

  it('rejects non-loopback hosts, credentials, hashes, sub-paths and long links', () => {
    expect(dshLinkFromArgs(['--dsh-link=http://example.com/?token=x'])).toBeUndefined();
    expect(dshLinkFromArgs(['--dsh-link=http://user:pass@127.0.0.1:1/?token=x'])).toBeUndefined();
    expect(dshLinkFromArgs(['--dsh-link=http://127.0.0.1:1/?token=x#frag'])).toBeUndefined();
    expect(dshLinkFromArgs(['--dsh-link=http://127.0.0.1:1/sub/?token=x'])).toBeUndefined();
    expect(dshLinkFromArgs(['--dsh-link=file:///tmp/x'])).toBeUndefined();
    expect(dshLinkFromArgs([`--dsh-link=http://127.0.0.1:1/?token=${'x'.repeat(4100)}`])).toBeUndefined();
  });
});

describe('launcherPidFromArgs', () => {
  it('accepts the host pid passed by the bundle', () => {
    expect(launcherPidFromArgs(['glass.exe', '--launcher-pid=4242'])).toBe(4242);
  });

  it('takes the last occurrence when the flag repeats', () => {
    expect(launcherPidFromArgs(['--launcher-pid=1', '--launcher-pid=99'])).toBe(99);
  });

  it('ignores malformed or signed values', () => {
    expect(launcherPidFromArgs(['--launcher-pid='])).toBeUndefined();
    expect(launcherPidFromArgs(['--launcher-pid=abc'])).toBeUndefined();
    expect(launcherPidFromArgs(['--launcher-pid=-12'])).toBeUndefined();
    expect(launcherPidFromArgs(['--launcher-pid=0'])).toBeUndefined();
    expect(launcherPidFromArgs(['--launcher-pid=99999999999'])).toBeUndefined();
    expect(launcherPidFromArgs([])).toBeUndefined();
  });
});
