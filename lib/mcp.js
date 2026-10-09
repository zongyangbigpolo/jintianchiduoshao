import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { parseNutrition } from './nutrition.js';

export async function fetchNutrition(token) {
  if (!token?.trim()) throw new Error('未配置 MCD_MCP_TOKEN。请在本机 .env 配置，或使用 npm run demo。');
  const client = new Client({ name: 'jintianchiduoshao', version: '1.0.0' });
  const authorization = token.startsWith('Bearer ') ? token : `Bearer ${token}`;
  const transport = new StreamableHTTPClientTransport(new URL('https://mcp.mcd.cn'), {
    requestInit: {
      headers: { Authorization: authorization },
      redirect: 'error',
      signal: AbortSignal.timeout(30_000)
    }
  });
  try {
    await client.connect(transport);
    const result = await client.callTool({ name: 'list-nutrition-foods', arguments: {} });
    return {
      foods: parseNutrition(result),
      source: '麦当劳 MCP · list-nutrition-foods',
      fetchedAt: new Date().toISOString(),
      demo: false
    };
  } catch (error) {
    // Do not forward upstream errors: they can contain request headers or account details.
    if (error?.code === 401 || error?.code === 403) {
      throw new Error('麦当劳鉴权失败，请检查或更新本机 MCD_MCP_TOKEN。');
    }
    throw new Error('无法获取有效的官方营养数据，请检查 Token、网络或服务状态；未切换为演示数据。');
  } finally {
    try {
      await client.close();
    } catch {
      console.error('MCP connection cleanup failed; no upstream details logged.');
    }
  }
}
