import { sendRuntimeControlRequest, type RuntimeControlMethod } from '../main/runtime/control.js';

export interface ControlClient {
  request(method: RuntimeControlMethod): Promise<unknown>;
}

export function createControlClient(profileDir: string): ControlClient {
  return {
    request(method) {
      return sendRuntimeControlRequest(profileDir, method);
    }
  };
}
