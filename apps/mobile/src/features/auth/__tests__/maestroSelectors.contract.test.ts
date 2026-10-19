/// <reference types="node" />
import { spawnSync } from 'node:child_process';
import { readFileSync, chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

function readFeatureSource(relativePath: string): string {
  return readFileSync(resolve(__dirname, relativePath), 'utf8');
}

function createRestoreRunnerHarness(mode = 'restore', failingFlow = '') {
  const workspace = mkdtempSync(resolve(tmpdir(), 'maestro-restore-contract-'));
  const javaHome = resolve(workspace, 'java-home');
  const maestroBin = resolve(workspace, 'home/.maestro/bin');
  const toolsBin = resolve(workspace, 'tools');
  const captureFile = resolve(workspace, 'runner-events.txt');
  const javaHomeResolver = resolve(workspace, 'java_home');

  mkdirSync(resolve(javaHome, 'bin'), { recursive: true });
  mkdirSync(maestroBin, { recursive: true });
  mkdirSync(toolsBin, { recursive: true });

  writeFileSync(
    resolve(javaHome, 'bin/java'),
    '#!/bin/sh\necho \'openjdk version "17.0.15"\' >&2\n'
  );
  writeFileSync(javaHomeResolver, `#!/bin/sh\necho '${javaHome}'\n`);
  writeFileSync(
    resolve(maestroBin, 'maestro'),
    '#!/bin/sh\nprintf \'MAESTRO\\n\' >> "$E2E_CAPTURE_FILE"\nprintf \'%s\\n\' "$@" >> "$E2E_CAPTURE_FILE"\n' +
      'if [ -n "$E2E_FAILING_FLOW" ]; then case "$*" in *"$E2E_FAILING_FLOW"*) exit 1 ;; esac; fi\n'
  );
  writeFileSync(
    resolve(toolsBin, 'sleep'),
    '#!/bin/sh\nprintf \'SLEEP\\n%s\\n\' "$1" >> "$E2E_CAPTURE_FILE"\n'
  );

  [
    resolve(javaHome, 'bin/java'),
    javaHomeResolver,
    resolve(maestroBin, 'maestro'),
    resolve(toolsBin, 'sleep'),
  ].forEach((path) => chmodSync(path, 0o755));

  return {
    captureFile,
    cleanup: () => rmSync(workspace, { force: true, recursive: true }),
    run: (waitSeconds?: string) =>
      spawnSync('sh', [resolve(__dirname, '../../../../scripts/run-maestro-e2e-macos.sh'), mode], {
        encoding: 'utf8',
        env: {
          ...process.env,
          E2E_ACCESS_TOKEN_EXPIRY_WAIT_SECONDS: waitSeconds,
          E2E_CAPTURE_FILE: captureFile,
          E2E_FAILING_FLOW: failingFlow,
          E2E_JAVA_HOME_RESOLVER: javaHomeResolver,
          E2E_LOGIN_CODE: '123456',
          E2E_LOGIN_EMAIL: 'e2e-user@example.test',
          HOME: resolve(workspace, 'home'),
          PATH: `${toolsBin}:${process.env.PATH ?? ''}`,
        },
      }),
  };
}

describe('Maestro login tracer selector contract', () => {
  it('exposes stable selectors for login, verification, and the authenticated gate', () => {
    expect(readFeatureSource('../components/AuthCredentialsForm.tsx')).toContain(
      'testID="e2e-login-email"'
    );
    expect(readFeatureSource('../screens/AuthLandingScreen.tsx')).toContain(
      'testID="e2e-request-login-code"'
    );
    expect(readFeatureSource('../components/VerificationCodeInput.tsx')).toContain(
      'testID="e2e-verification-code"'
    );
    expect(readFeatureSource('../components/VerificationActions.tsx')).toContain(
      'testID="e2e-verify-code"'
    );
    expect(readFileSync(resolve(__dirname, '../../home/screens/HomeScreen.tsx'), 'utf8')).toContain(
      'testID="e2e-home-screen"'
    );
  });

  it('dismisses the success alert before checking Home in the Maestro flow', () => {
    const maestroFlow = readFileSync(
      resolve(__dirname, '../../../../e2e/maestro/login-verification.yaml'),
      'utf8'
    );

    // `clearState` keeps the iOS Keychain, so a session of an earlier run would skip login.
    expect(maestroFlow.indexOf('- clearKeychain')).toBeGreaterThan(-1);
    expect(maestroFlow.indexOf('- clearKeychain')).toBeLessThan(
      maestroFlow.indexOf('clearState: true')
    );
    expect(maestroFlow).toContain('Sesión iniciada');
    expect(maestroFlow).toContain('tapOn:');
    expect(maestroFlow).toContain('OK');
    expect(maestroFlow).toContain('id: e2e-home-screen');
    expect(maestroFlow.indexOf('OK')).toBeLessThan(maestroFlow.indexOf('id: e2e-home-screen'));
  });

  it('preserves the original login-only command and keeps Expo native scripts convergent', () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(__dirname, '../../../../package.json'), 'utf8')
    ) as { scripts: Record<string, string> };

    expect(packageJson.scripts['e2e:maestro']).toBe('sh ./scripts/run-maestro-e2e-macos.sh');
    expect(packageJson.scripts.android).toBe('expo run:android');
    expect(packageJson.scripts.ios).toBe('expo run:ios');
    expect(packageJson.scripts['android:start']).toBe('expo start --android');
    expect(packageJson.scripts['ios:start']).toBe('expo start --ios');
  });

  it('composes login, expiry wait, and restoration in the intentional restore command', () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(__dirname, '../../../../package.json'), 'utf8')
    ) as { scripts: Record<string, string> };
    const harness = createRestoreRunnerHarness();

    try {
      const result = harness.run();

      expect(packageJson.scripts['e2e:maestro:restore']).toBe(
        'sh ./scripts/run-maestro-e2e-macos.sh restore'
      );
      expect(result.status).toBe(0);
      expect(readFileSync(harness.captureFile, 'utf8')).toMatch(
        /MAESTRO[\s\S]*e2e\/maestro\/login-verification\.yaml\nSLEEP\n4\nMAESTRO[\s\S]*e2e\/maestro\/authenticated-restoration\.yaml\n$/
      );
    } finally {
      harness.cleanup();
    }
  });

  it('cold-relaunches without clearing persisted authentication before asserting Home', () => {
    const restorationFlow = readFileSync(
      resolve(__dirname, '../../../../e2e/maestro/authenticated-restoration.yaml'),
      'utf8'
    );

    expect(restorationFlow).toContain('- stopApp');
    expect(restorationFlow).toContain('clearState: false');
    expect(restorationFlow).not.toContain('clearState: true');
    expect(restorationFlow).toContain('id: e2e-home-screen');
    expect(restorationFlow.indexOf('- stopApp')).toBeLessThan(
      restorationFlow.indexOf('clearState: false')
    );
    expect(restorationFlow.indexOf('clearState: false')).toBeLessThan(
      restorationFlow.indexOf('id: e2e-home-screen')
    );
  });

  it('accepts only safe expiry waits from 4 through 300 seconds', () => {
    for (const invalidWait of ['3', '4.5', '4; touch injected', '301']) {
      const harness = createRestoreRunnerHarness();

      try {
        const result = harness.run(invalidWait);

        expect(result.status).toBe(1);
        expect(result.stderr).toContain(
          'E2E_ACCESS_TOKEN_EXPIRY_WAIT_SECONDS must be an integer from 4 through 300.'
        );
      } finally {
        harness.cleanup();
      }
    }

    const harness = createRestoreRunnerHarness();

    try {
      const result = harness.run('7');

      expect(result.status).toBe(0);
      expect(readFileSync(harness.captureFile, 'utf8')).toContain('\nSLEEP\n7\n');
    } finally {
      harness.cleanup();
    }
  });

  it('rejects a stale java_home result and runs Maestro with Homebrew JDK 17', () => {
    const workspace = mkdtempSync(resolve(tmpdir(), 'maestro-jdk-contract-'));
    const macJavaHome = resolve(workspace, 'mac-java-home');
    const brewPrefix = resolve(workspace, 'openjdk@17');
    const maestroBin = resolve(workspace, 'home/.maestro/bin');
    const captureFile = resolve(workspace, 'maestro-invocation.txt');
    const javaHomeResolver = resolve(workspace, 'java_home');
    const brew = resolve(workspace, 'brew');

    try {
      mkdirSync(resolve(macJavaHome, 'bin'), { recursive: true });
      mkdirSync(resolve(brewPrefix, 'libexec/openjdk.jdk/Contents/Home/bin'), { recursive: true });
      mkdirSync(maestroBin, { recursive: true });

      writeFileSync(
        resolve(macJavaHome, 'bin/java'),
        '#!/bin/sh\necho \'openjdk version "11.0.0"\' >&2\n'
      );
      writeFileSync(
        resolve(brewPrefix, 'libexec/openjdk.jdk/Contents/Home/bin/java'),
        '#!/bin/sh\necho \'openjdk version "17.0.15"\' >&2\n'
      );
      writeFileSync(javaHomeResolver, `#!/bin/sh\necho '${macJavaHome}'\n`);
      writeFileSync(brew, `#!/bin/sh\necho '${brewPrefix}'\n`);
      writeFileSync(
        resolve(maestroBin, 'maestro'),
        '#!/bin/sh\nprintf \'JAVA_HOME=%s\\n\' "$JAVA_HOME" > "$E2E_CAPTURE_FILE"\nprintf \'%s\\n\' "$@" >> "$E2E_CAPTURE_FILE"\n'
      );

      [
        resolve(macJavaHome, 'bin/java'),
        resolve(brewPrefix, 'libexec/openjdk.jdk/Contents/Home/bin/java'),
        javaHomeResolver,
        brew,
        resolve(maestroBin, 'maestro'),
      ].forEach((path) => chmodSync(path, 0o755));

      const result = spawnSync(
        'sh',
        [resolve(__dirname, '../../../../scripts/run-maestro-e2e-macos.sh')],
        {
          encoding: 'utf8',
          env: {
            ...process.env,
            E2E_BREW_BIN: brew,
            E2E_CAPTURE_FILE: captureFile,
            E2E_JAVA_HOME_RESOLVER: javaHomeResolver,
            E2E_LOGIN_CODE: '123456',
            E2E_LOGIN_EMAIL: 'e2e-user@example.test',
            HOME: resolve(workspace, 'home'),
          },
        }
      );

      expect(result.status).toBe(0);
      const invocation = readFileSync(captureFile, 'utf8').split('\n');

      expect(invocation).toEqual(
        expect.arrayContaining([
          `JAVA_HOME=${brewPrefix}/libexec/openjdk.jdk/Contents/Home`,
          '-e',
          'E2E_LOGIN_EMAIL=e2e-user@example.test',
          'E2E_LOGIN_CODE=123456',
          '--test-output-dir=e2e/artifacts/maestro',
          'e2e/maestro/login-verification.yaml',
        ])
      );
      expect(invocation).not.toContain('e2e/maestro/authenticated-restoration.yaml');
    } finally {
      rmSync(workspace, { force: true, recursive: true });
    }
  });
});

function readMobileFile(relativePath: string): string {
  return readFileSync(resolve(__dirname, '../../../..', relativePath), 'utf8');
}

// Every `id:` a flow selects, in order.
function flowSelectors(flow: string): string[] {
  return [...readMobileFile(`e2e/maestro/${flow}.yaml`).matchAll(/id: (\S+)/g)].map(
    (match) => match[1]
  );
}

describe('Maestro Planning and Shopping selector contract', () => {
  it('exposes the testIDs the Planning and Shopping flows select', () => {
    const sources: [string, string][] = [
      ['src/features/home/screens/HomeScreen.tsx', 'testID="e2e-home-screen"'],
      ['src/components/AddCircleButton.tsx', 'testID="e2e-home-open-planner"'],
      ['src/features/planner/components/PlanningDraftPanel.tsx', "'e2e-planner-start'"],
      ['src/features/planner/components/PlanningDraftPanel.tsx', 'testID="e2e-planner-proposal"'],
      ['src/features/planner/components/PlanningDraftPanel.tsx', "'e2e-planner-confirm'"],
      ['src/features/planner/components/PlanningDraftPanel.tsx', 'testID="e2e-planner-committed"'],
      ['src/features/planner/components/PlannerHeader.tsx', 'testID="e2e-planner-close"'],
      ['src/features/home/components/FoodCard/FoodCard.tsx', "'e2e-home-scheduled-meal'"],
      ['app/(tabs)/_layout.tsx', "tabBarButtonTestID: 'e2e-tab-cart'"],
      ['app/(tabs)/_layout.tsx', 'testID={options.tabBarButtonTestID}'],
      ['src/features/shopping/screens/ShoppingScreen.tsx', 'testID="e2e-shopping-screen"'],
      ['src/features/shopping/components/ShoppingItemRow.tsx', "'e2e-shopping-item-in-cart'"],
      ['src/features/shopping/components/ShoppingItemRow.tsx', "'e2e-shopping-item'"],
    ];

    for (const [path, selector] of sources) {
      expect(readMobileFile(path)).toContain(selector);
    }
  });

  it('plans, confirms and checks the Scheduled meals by testID, after signing in', () => {
    const flow = readMobileFile('e2e/maestro/planning-confirm.yaml');

    expect(flow).toContain('- runFlow: login-verification.yaml');
    expect(flowSelectors('planning-confirm')).toEqual([
      'e2e-home-scheduled-meal',
      'e2e-home-open-planner',
      'e2e-planner-start',
      'e2e-planner-start',
      'e2e-planner-proposal',
      'e2e-planner-confirm',
      'e2e-planner-confirm',
      'e2e-planner-committed',
      'e2e-planner-close',
      'e2e-home-scheduled-meal',
    ]);
  });

  it('opens the Shopping list and checks an item off by testID, after signing in', () => {
    const flow = readMobileFile('e2e/maestro/shopping-check-off.yaml');

    expect(flow).toContain('- runFlow: login-verification.yaml');
    expect(flowSelectors('shopping-check-off')).toEqual([
      'e2e-tab-cart',
      'e2e-shopping-screen',
      'e2e-shopping-item',
      'e2e-shopping-item-in-cart',
      'e2e-shopping-item',
      'e2e-shopping-item-in-cart',
    ]);
  });

  it('never selects by visible copy in the Planning and Shopping flows', () => {
    for (const flow of ['planning-confirm', 'shopping-check-off']) {
      const lines = readMobileFile(`e2e/maestro/${flow}.yaml`).split('\n');

      // A bare `tapOn: <text>` or `visible: <text>`, or a `text:` key, selects by copy; every
      // selector is an `id:`.
      expect(
        lines.filter(
          (line) =>
            /^\s*-?\s*(tapOn|visible|assertVisible|assertNotVisible):\s*\S/.test(line) ||
            /^\s*-?\s*text:/.test(line)
        )
      ).toEqual([]);
    }
  });

  it('runs every flow in order with all', () => {
    const harness = createRestoreRunnerHarness('all');

    try {
      const result = harness.run();

      expect(result.status).toBe(0);
      expect(readFileSync(harness.captureFile, 'utf8')).toMatch(
        /MAESTRO[\s\S]*e2e\/maestro\/login-verification\.yaml\nSLEEP\n4\nMAESTRO[\s\S]*e2e\/maestro\/authenticated-restoration\.yaml\nMAESTRO[\s\S]*e2e\/maestro\/planning-confirm\.yaml\nMAESTRO[\s\S]*e2e\/maestro\/shopping-check-off\.yaml\n$/
      );
    } finally {
      harness.cleanup();
    }
  });

  it('stops with a non-zero exit at the first flow of all that fails', () => {
    const harness = createRestoreRunnerHarness('all', 'planning-confirm');

    try {
      const result = harness.run();
      const events = readFileSync(harness.captureFile, 'utf8');

      expect(result.status).not.toBe(0);
      expect(events).toContain('e2e/maestro/planning-confirm.yaml');
      expect(events).not.toContain('e2e/maestro/shopping-check-off.yaml');
    } finally {
      harness.cleanup();
    }
  });

  it('runs one flow by name, and fails for a flow that does not exist', () => {
    const harness = createRestoreRunnerHarness('shopping-check-off');

    try {
      const result = harness.run();
      const invocations = readFileSync(harness.captureFile, 'utf8');

      expect(result.status).toBe(0);
      expect(invocations).toContain('E2E_LOGIN_EMAIL=e2e-user@example.test');
      expect(invocations.match(/e2e\/maestro\/\S+\.yaml/g)).toEqual([
        'e2e/maestro/shopping-check-off.yaml',
      ]);
    } finally {
      harness.cleanup();
    }

    for (const unknownMode of ['missing-flow', '../package', 'Login']) {
      const unknown = createRestoreRunnerHarness(unknownMode);

      try {
        const result = unknown.run();

        expect(result.status).toBe(1);
        expect(result.stderr).toContain(`Unknown Maestro E2E mode: ${unknownMode}`);
      } finally {
        unknown.cleanup();
      }
    }
  });
});
