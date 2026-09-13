import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { childEnv } from '../exec.js';
import type { CredentialProvider } from './provider.js';

const WRAP_AAD = Buffer.from('comgu-cli-master-key-wrap-v1', 'utf8');
const SYSTEMD_CREDENTIAL_NAME = 'comgu-vault-key';
const SECRET_SERVICE_PREFIX = 'secret-service:v1:';

export interface SecretToolAdapter {
  status(): Promise<boolean>;
  store(scope: string, value: Buffer): Promise<void>;
  lookup(scope: string): Promise<Buffer | null>;
}

interface LinuxProviderOptions {
  platform?: NodeJS.Platform;
  scope: string;
  env?: NodeJS.ProcessEnv;
  secretTool?: SecretToolAdapter;
}

function parseWrappingKey(text: string | undefined): Buffer | null {
  if (!text) return null;
  try {
    const key = Buffer.from(text.trim(), 'base64');
    return key.length === 32 ? key : null;
  } catch {
    return null;
  }
}

async function runSecretTool(args: string[], input: string | null, env: NodeJS.ProcessEnv): Promise<{ code: number; stdout: string }> {
  return new Promise((resolve, reject) => {
    const dbus = env.DBUS_SESSION_BUS_ADDRESS;
    const child = spawn('secret-tool', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: childEnv(dbus ? { DBUS_SESSION_BUS_ADDRESS: dbus } : undefined)
    });
    const stdout: Buffer[] = [];
    let bytes = 0;
    let settled = false;
    const finish = (error?: Error, result?: { code: number; stdout: string }): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(result!);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(new Error('secret-tool timed out'));
    }, 8_000);
    timer.unref?.();
    child.stdout.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes <= 8_192) stdout.push(chunk);
    });
    child.stderr.resume();
    child.on('error', () => finish(new Error('secret-tool unavailable')));
    child.on('close', (code) =>
      finish(undefined, {
        code: code ?? -1,
        stdout: bytes <= 8_192 ? Buffer.concat(stdout).toString('utf8').trim() : ''
      })
    );
    child.stdin.end(input ?? '');
  });
}

function createSecretToolAdapter(env: NodeJS.ProcessEnv): SecretToolAdapter {
  return {
    async status() {
      if (!env.DBUS_SESSION_BUS_ADDRESS) return false;
      try {
        const result = await runSecretTool(['--version'], null, env);
        return result.code === 0;
      } catch {
        return false;
      }
    },
    async store(scope, value) {
      const result = await runSecretTool(
        ['store', '--label=ComGu credential vault', 'comgu-vault', scope],
        value.toString('base64'),
        env
      );
      if (result.code !== 0) throw new Error('Secret Service store failed');
    },
    async lookup(scope) {
      const result = await runSecretTool(['lookup', 'comgu-vault', scope], null, env);
      if (result.code !== 0 || result.stdout.length === 0) return null;
      const value = Buffer.from(result.stdout, 'base64');
      return value.length > 0 ? value : null;
    }
  };
}

function wrap(masterKey: Buffer, wrappingKey: Buffer): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', wrappingKey, iv);
  cipher.setAAD(WRAP_AAD);
  const ciphertext = Buffer.concat([cipher.update(masterKey), cipher.final()]);
  return Buffer.from(
    JSON.stringify({
      version: 1,
      kind: 'wrapped',
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      ciphertext: ciphertext.toString('base64')
    }),
    'utf8'
  );
}

function unwrap(blob: Buffer, wrappingKey: Buffer): Buffer {
  try {
    const parsed = JSON.parse(blob.toString('utf8')) as Record<string, unknown>;
    if (parsed['version'] !== 1 || parsed['kind'] !== 'wrapped') throw new Error('invalid wrapped key');
    const iv = Buffer.from(String(parsed['iv']), 'base64');
    const tag = Buffer.from(String(parsed['tag']), 'base64');
    const ciphertext = Buffer.from(String(parsed['ciphertext']), 'base64');
    if (iv.length !== 12 || tag.length !== 16) throw new Error('invalid wrapped key');
    const decipher = createDecipheriv('aes-256-gcm', wrappingKey, iv);
    decipher.setAAD(WRAP_AAD);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    throw new Error('Linux credential protection failed');
  }
}

export function createLinuxCredentialProvider(options: LinuxProviderOptions): CredentialProvider {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const scope = options.scope;
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(scope)) throw new Error('Invalid Linux credential scope');
  const secretTool = options.secretTool ?? createSecretToolAdapter(env);

  const externalKey = async (): Promise<{ key: Buffer; detail: 'systemd-credential' | 'environment' } | null> => {
    const credentialDir = env.CREDENTIALS_DIRECTORY;
    if (credentialDir) {
      try {
        const text = await fs.readFile(path.join(credentialDir, SYSTEMD_CREDENTIAL_NAME), 'utf8');
        const key = parseWrappingKey(text);
        if (key) return { key, detail: 'systemd-credential' };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return null;
      }
    }
    const injected = parseWrappingKey(env.COMGU_CREDENTIAL_KEY);
    return injected ? { key: injected, detail: 'environment' } : null;
  };

  const source = async (): Promise<
    | { kind: 'wrap'; key: Buffer; detail: 'systemd-credential' | 'environment' }
    | { kind: 'secret-service'; detail: 'secret-service' }
    | null
  > => {
    if (platform !== 'linux') return null;
    const wrapping = await externalKey();
    if (wrapping) return { kind: 'wrap', ...wrapping };
    if (env.DBUS_SESSION_BUS_ADDRESS && (await secretTool.status())) return { kind: 'secret-service', detail: 'secret-service' };
    return null;
  };

  return {
    async status() {
      const selected = await source();
      return selected
        ? { available: true as const, reason: 'available' as const, detail: selected.detail }
        : {
            available: false as const,
            reason: 'provider_unavailable' as const,
            detail: 'No secure Linux credential source is available.'
          };
    },
    async protect(data) {
      const selected = await source();
      if (!selected) throw new Error('No secure Linux credential source is available');
      if (selected.kind === 'wrap') return wrap(data, selected.key);
      try {
        await secretTool.store(scope, data);
        return Buffer.from(`${SECRET_SERVICE_PREFIX}${scope}`, 'utf8');
      } catch {
        throw new Error('Linux credential protection failed');
      }
    },
    async unprotect(data) {
      const text = data.toString('utf8');
      if (text.startsWith(SECRET_SERVICE_PREFIX)) {
        if (text !== `${SECRET_SERVICE_PREFIX}${scope}`) throw new Error('Linux credential protection failed');
        try {
          const value = await secretTool.lookup(scope);
          if (!value) throw new Error('missing Secret Service key');
          return { data: value, shouldReprotect: false };
        } catch {
          throw new Error('Linux credential protection failed');
        }
      }
      const selected = await source();
      if (!selected || selected.kind !== 'wrap') throw new Error('No secure Linux credential source is available');
      return { data: unwrap(data, selected.key), shouldReprotect: false };
    }
  };
}
