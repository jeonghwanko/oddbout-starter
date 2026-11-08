// @ts-check
import { generate, reuse, status } from '../tools/voice-studio/client.mjs';

const [command, ...args] = process.argv.slice(2);
const help = `Local VoiceStudio (Node 22+, no npm install required)
  node scripts/voicestudio.mjs status
  node scripts/voicestudio.mjs reuse --input SOURCE.wav --out output/voice-studio/sample.wav [--source-report REPORT.json]
  node scripts/voicestudio.mjs generate --out output/voice-studio/new-take.wav [--text TEXT] [--voice M1] [--speed 0.85] [--language ko]
Environment: VOICESTUDIO_URL defaults to http://127.0.0.1:3900 and accepts loopback only.
WAVs are separate AI-generated production artifacts, outside the fighter v1 WebP contract.
Existing output files are never overwritten. generate performs local synthesis; reuse does not.`;

try {
  if (!command || ['help', '--help', '-h'].includes(command)) {
    console.log(help);
  } else {
    if (!['status', 'reuse', 'generate'].includes(command)) throw new Error(`Unknown command: ${command}`);
    const allowed = new Set(
      command === 'reuse' ? ['input', 'out', 'source-report'] : command === 'generate' ? ['out', 'text', 'voice', 'speed', 'language'] : [],
    );
    /** @type {Record<string, string>} */
    const options = {};
    for (let index = 0; index < args.length; index += 2) {
      const key = args[index].replace(/^--/, '');
      if (!args[index].startsWith('--') || !allowed.has(key) || args[index + 1] == null || key in options) {
        throw new Error(`Invalid or duplicate option: ${args[index]}`);
      }
      options[key] = args[index + 1];
    }
    const baseUrl = process.env.VOICESTUDIO_URL;
    let result;
    if (command === 'status') {
      result = await status({ baseUrl });
      if (!result.ready) process.exitCode = 1;
    } else {
      if (!options.out) throw new Error('--out is required.');
      if (command === 'reuse') {
        if (!options.input) throw new Error('--input is required.');
        // tools/voice-studio is unchecked: its inferred options make fetchImpl required and leave generate's output out.
        result = await /** @type {(options: { input: string, output: string, sourceReport?: string, baseUrl?: string }) => ReturnType<typeof reuse>} */ (reuse)(
          { input: options.input, output: options.out, sourceReport: options['source-report'], baseUrl },
        );
      } else {
        result =
          await /** @type {(options: { output: string, text?: string, voice?: string, language?: string, speed?: number, baseUrl?: string }) => ReturnType<typeof generate>} */ (
            generate
          )({
            output: options.out,
            text: options.text,
            voice: options.voice,
            language: options.language,
            speed: options.speed == null ? undefined : Number(options.speed),
            baseUrl,
          });
      }
    }
    console.log(JSON.stringify(result, null, 2));
  }
} catch (/** @type {any} */ error) {
  console.error(`VoiceStudio: ${error.message}`);
  process.exitCode = 1;
}
