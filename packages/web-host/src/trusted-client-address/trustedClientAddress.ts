import type { IncomingHttpHeaders, OutgoingHttpHeaders } from 'node:http';

export type TcpConnectionObserver = {
  connected: (localPort: number) => void;
  closed: (localPort: number) => void;
};

const TRUSTED_CLIENT_ADDRESS_HEADER = 'x-aionui-client-address';

/** Tracks the public socket address across the private TCP splice. */
export class TrustedClientAddressRelay {
  private readonly addressesByInternalPort = new Map<number, string>();

  resolve(internalRemotePort?: number): string | null {
    if (internalRemotePort === undefined) return null;
    return this.addressesByInternalPort.get(internalRemotePort) ?? null;
  }

  observe(clientAddress?: string): TcpConnectionObserver | undefined {
    if (!clientAddress) return undefined;
    return {
      connected: (localPort): void => {
        this.addressesByInternalPort.set(localPort, clientAddress);
      },
      closed: (localPort): void => {
        this.addressesByInternalPort.delete(localPort);
      },
    };
  }
}

/** Replaces an untrusted internal address header with the public socket observation. */
export function createProxyHeaders(
  headers: IncomingHttpHeaders,
  host: string,
  clientAddress?: string | null
): OutgoingHttpHeaders {
  const proxyHeaders: OutgoingHttpHeaders = { ...headers, host };
  if (clientAddress === undefined) return proxyHeaders;

  delete proxyHeaders[TRUSTED_CLIENT_ADDRESS_HEADER];
  if (clientAddress) proxyHeaders[TRUSTED_CLIENT_ADDRESS_HEADER] = clientAddress;
  return proxyHeaders;
}
