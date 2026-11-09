import type http from 'node:http';

/** Windows may reject a transient ephemeral loopback port with EACCES. */
export async function listenOnLoopback(server: http.Server, retries = 4): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await new Promise<void>((resolve, reject) => {
        const onError = (error: Error): void => {
          server.off('listening', onListening);
          reject(error);
        };
        const onListening = (): void => {
          server.off('error', onError);
          resolve();
        };
        server.once('error', onError);
        server.once('listening', onListening);
        try { server.listen(0, '127.0.0.1'); }
        catch (error) {
          server.off('error', onError);
          server.off('listening', onListening);
          reject(error);
        }
      });
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (attempt >= retries || (code !== 'EACCES' && code !== 'EADDRINUSE')) throw error;
      await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
    }
  }
}
