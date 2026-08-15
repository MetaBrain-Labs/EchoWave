/** Maps Node listener failures to concise, actionable startup messages. */
export function formatServerStartError(error: Error, port: number): string {
  if ('code' in error && error.code === 'EADDRINUSE') {
    return `EchoWave API could not start: port ${port} is already in use. Stop the existing process or change PORT in apps/api/.env.`;
  }

  return `EchoWave API could not start: ${error.message}`;
}
