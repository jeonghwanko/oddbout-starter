// @ts-check
// The cloud connector cannot open a Dots VM path. It returns structured invocations for the local MCP executor.
import { z } from 'zod';
import runtime from './packaging-runtime.json' with { type: 'json' };

const absolute = z.string().min(1).max(512).refine(value => !/[\x00-\x1f]/.test(value)
  && (/^\//.test(value) || /^[A-Za-z]:[\\/]/.test(value)), 'existing absolute workspace path required');
const relative = z.string().min(1).max(512).refine(value => !/[\\:\x00-\x1f]/.test(value) && !value.startsWith('/')
  && value.split('/').every(part => part && part !== '.' && part !== '..'), 'workspace-relative path required');
/** @param {{ register: import('./common.mjs').Register, invoke: import('./common.mjs').Invoke }} options */
export function registerPackagingPreparation({ register, invoke }) {
  register('prepare_fighter_packaging', '기존 파일 포장·복구',
    'Prepare inspection and packaging of existing fighter files in a Dots/PC workspace. Use for SHEET_TOO_LARGE or packaging recovery. '
    + 'Returns exact local MCP/CLI invocations, not an executed package: this cloud server cannot read VM paths. '
    + 'Run them through the host execution tool, inspect actual results, then continue the existing registration request. '
    + 'Never regenerate or ask the user to relay packaging errors. fitSheets permits resolution reduction only within the user’s requested optimization; '
    + 'all frame identities, playback timing, game size and required file checks remain. No generation account or new registration login is needed.',
    { workspacePath: absolute, kitPath: absolute.describe('Absolute extracted plugin directory, containing runtime/ and launcher.mjs.'),
      planPath: relative, outputPath: relative, fitSheets: z.boolean().default(false) },
    async ({ workspacePath, kitPath, planPath, outputPath, fitSheets }) => {
      const result = await invoke('spec');
      if (!result.ok) return result;
      const features = result.data?.features ?? [];
      if (fitSheets && !features.includes('texture-resolution-1')) return { ok: false, code: 'server-feature-missing',
        feature: 'texture-resolution-1', next: 'Keep original files. Resolution fitting is not yet supported by the deployed contract.' };
      const root = kitPath.replace(/\\/g, '/').replace(/\/$/, '');
      const runtimeDirectory = `${root}/runtime`;
      const args = { planPath, outputPath, fitSheets };
      return { ok: true, stage: 'workspace-execution-required', minimumKitVersion: runtime.version, runtime,
        contract: { features, limits: result.data?.limits, textureResolution: result.data?.textureResolution },
        runtimeDirectory,
        dependencyInstall: { command: 'npm', args: ['ci', '--ignore-scripts'], cwd: runtimeDirectory },
        prerequisites: ['Use the reviewed kit in a separate directory; preserve the active workspace runtime and selected versions.',
          'Verify the download helper with helperSha256 before running it; pass manifestUrl and manifestSha256 to its download command. '
          + 'The new destination contains plugin/. kitPath must name that extracted plugin root.',
          'Install locked Node dependencies in runtimeDirectory if missing, using dependencyInstall. Existing game-pack input needs no Python engine or generation login.'],
        operations: ['inspect_fighter_packaging', 'pack_fighter_package'].map(tool => ({ tool, arguments: args,
          execution: { command: 'node', args: [`${runtimeDirectory}/scripts/creation-tool.mjs`, 'call', workspacePath, tool, '<arguments-json-file>'],
            argumentsFileContents: args } })),
        recovery: { intermediateTooLarge: 'Use the same game-pack request with --image-format webp and a new output directory; '
          + 'only if needed, --max-bytes 200000000. The final upload limits still apply.',
          sheetTooLarge: fitSheets ? 'The packer fits bounded texture resolution and records pixelScale; keep every frame and timing.'
            : 'Inspect the returned layout. Preserve pixels unless the user requested resolution optimization.',
          qualityDiagnostics: 'Deferred; never require a passing gait report or another quality approval to package.' },
        next: 'Run inspection, then build into the new output path if supported. Read actual validation results. '
          + 'Use the connected registration tools within the existing user request; never claim registration from local packaging.' };
    }, { publicTool: true });
}
