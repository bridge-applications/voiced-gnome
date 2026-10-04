import { DemoSession, DemoBudget } from '../../apps/worker/src/quota';
export { DemoBudget };
export class SessionUnderTest extends DemoSession {
  expireForTest(): void {
    this.ctx.storage.sql.exec(
      "UPDATE entries SET value = json_set(value, '$.expiresAt', 0) WHERE name = 'visitor'",
    );
  }
}
interface TestEnv {
  SESSIONS: DurableObjectNamespace<SessionUnderTest>;
  BUDGETS: DurableObjectNamespace<DemoBudget>;
}
export default {
  async fetch(request: Request, env: TestEnv): Promise<Response> {
    const body = (await request.json()) as {
      type: string;
      name: string;
      method: string;
      id?: string;
      origin?: string;
      day?: string;
      ip?: string;
      operation?: 'conversation' | 'speech' | 'verification';
      characters?: number;
    };
    const session = env.SESSIONS.getByName(body.name),
      budget = env.BUDGETS.getByName(body.name);
    let result: unknown;
    if (body.type === 'session') {
      if (body.method === 'init')
        result = await session.initialize(body.origin!);
      else if (body.method === 'expire') await session.expireForTest();
      else if (body.method === 'finish')
        await session.finish(
          body.id!,
          body.operation as 'conversation' | 'speech',
        );
      else
        result = await session.reserve(
          body.origin!,
          body.id!,
          body.operation as 'conversation' | 'speech',
          body.characters ?? 0,
        );
    } else {
      if (body.method === 'finish') await budget.finish(body.id!);
      else
        result = await budget.reserve(
          body.day!,
          body.id!,
          body.ip!,
          body.operation!,
          body.characters ?? 0,
        );
    }
    return Response.json(result ?? null);
  },
};
