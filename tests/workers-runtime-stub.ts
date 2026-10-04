export class DurableObject<Env> {
  constructor(
    protected ctx: DurableObjectState,
    protected env: Env,
  ) {}
}
