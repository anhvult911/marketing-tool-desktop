import net from 'net';

export interface ParsedProxy {
  host: string;
  port: number;
  username?: string;
  password?: string;
  protocol: string;
}

/**
 * Universal parser for proxy lines in any popular format:
 * - host:port
 * - host:port:user:pass
 * - host|port|user|pass
 * - user:pass@host:port
 * - host:port@user:pass
 * - user:pass:host:port
 * - http:// / https:// / socks5:// prefixes
 * - Space or tab separated
 */
export function parseProxyLine(rawLine: string): ParsedProxy | null {
  if (!rawLine || typeof rawLine !== 'string') return null;
  let line = rawLine.trim();
  if (!line) return null;

  // Extract and strip protocol prefix
  let protocol = 'http';
  const protoMatch = line.match(/^([a-zA-Z0-9]+):\/\//);
  if (protoMatch) {
    protocol = protoMatch[1].toLowerCase();
    line = line.replace(/^[a-zA-Z0-9]+:\/\//, '');
  }

  let username: string | undefined;
  let password: string | undefined;
  let host = '';
  let port = 0;

  // Format with @ (e.g. user:pass@host:port OR host:port@user:pass)
  if (line.includes('@')) {
    const atParts = line.split('@');
    if (atParts.length === 2) {
      const [partA, partB] = atParts;
      const subA = partA.split(':');
      const subB = partB.split(':');

      // Check if partB is host:port
      if (subB.length === 2 && !isNaN(parseInt(subB[1], 10))) {
        const p = parseInt(subB[1], 10);
        if (p > 0 && p <= 65535) {
          host = subB[0];
          port = p;
          username = subA[0] || undefined;
          password = subA[1] || undefined;
        }
      }
      // Check if partA is host:port
      else if (subA.length === 2 && !isNaN(parseInt(subA[1], 10))) {
        const p = parseInt(subA[1], 10);
        if (p > 0 && p <= 65535) {
          host = subA[0];
          port = p;
          username = subB[0] || undefined;
          password = subB[1] || undefined;
        }
      }
    }
  }

  // If not yet matched, try delimiter splitting ('|', ':', or whitespace)
  if (!host || port === 0) {
    let parts: string[] = [];
    if (line.includes('|')) {
      parts = line.split('|').map((p) => p.trim());
    } else if (line.includes(':')) {
      parts = line.split(':').map((p) => p.trim());
    } else if (/\s+/.test(line)) {
      parts = line.split(/\s+/).map((p) => p.trim());
    }

    if (parts.length >= 2) {
      // Priority 1: standard host:port:user:pass
      const portCandidate = parseInt(parts[1], 10);
      if (!isNaN(portCandidate) && portCandidate > 0 && portCandidate <= 65535) {
        host = parts[0];
        port = portCandidate;
        if (parts.length >= 4) {
          username = parts[2];
          password = parts[3];
        } else if (parts.length === 3) {
          username = parts[2];
        }
      }
      // Priority 2: user:pass:host:port
      else if (parts.length >= 4) {
        const lastPortCandidate = parseInt(parts[3], 10);
        if (!isNaN(lastPortCandidate) && lastPortCandidate > 0 && lastPortCandidate <= 65535) {
          username = parts[0];
          password = parts[1];
          host = parts[2];
          port = lastPortCandidate;
        }
      }
    }
  }

  // Final cleanup and validation
  host = host.replace(/^\/+/, '').replace(/\/.*$/, '').trim();

  if (host && port > 0 && port <= 65535) {
    return {
      host,
      port,
      username: username?.trim() || undefined,
      password: password?.trim() || undefined,
      protocol: protocol || 'http',
    };
  }

  return null;
}

/**
 * Socket-based proxy connectivity test
 */
export function checkProxyLive(host: string, port: number, username?: string, password?: string, timeoutMs: number = 6000): Promise<boolean> {
  return new Promise((resolve) => {
    let resolved = false;
    const finish = (isLive: boolean) => {
      if (!resolved) {
        resolved = true;
        resolve(isLive);
      }
    };

    const socket = net.createConnection({ host, port, timeout: timeoutMs }, () => {
      let connectHeader = `CONNECT google.com:443 HTTP/1.1\r\nHost: google.com:443\r\n`;
      if (username && password) {
        const auth = Buffer.from(`${username}:${password}`).toString('base64');
        connectHeader += `Proxy-Authorization: Basic ${auth}\r\n`;
      }
      connectHeader += `\r\n`;
      try {
        socket.write(connectHeader);
      } catch {
        socket.destroy();
        finish(false);
      }
    });

    socket.on('data', (data) => {
      const response = data.toString();
      socket.destroy();
      if (
        response.includes('200') ||
        response.includes('Connection established') ||
        response.includes('Established') ||
        response.includes('HTTP/1.1 200') ||
        response.includes('HTTP/1.0 200')
      ) {
        finish(true);
      } else {
        finish(false);
      }
    });

    socket.on('timeout', () => {
      socket.destroy();
      finish(false);
    });

    socket.on('error', () => {
      socket.destroy();
      finish(false);
    });
  });
}
