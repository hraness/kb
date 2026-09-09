import { Cause, Effect, Exit, Option } from "effect";

/** A raw native or policy failure, including falsey values; never mutate its object. */
export class AuthoringFailure {
  constructor(readonly reason: unknown) {}
}

export function authoringNative<A>(operation: () => PromiseLike<A>): Effect.Effect<A, AuthoringFailure> {
  // Once a native operation is admitted, retain its actual settlement. Public
  // authoring has no cancellation API and cannot abandon a late descriptor.
  return Effect.uninterruptible(Effect.tryPromise({
    try: () => Promise.resolve(operation()),
    catch: (reason: unknown) => new AuthoringFailure(reason),
  }));
}

export function authoringSync<A>(operation: () => A): Effect.Effect<A, AuthoringFailure> {
  return Effect.try({ try: operation, catch: (reason: unknown) => new AuthoringFailure(reason) });
}

export function authoringCauseValue(cause: Cause.Cause<AuthoringFailure>): unknown {
  const failure = Cause.failureOption(cause);
  if (Option.isSome(failure)) return failure.value.reason;
  const defect = Cause.dieOption(cause);
  if (Option.isSome(defect)) return defect.value;
  return cause;
}

/** The native finally law: this resource's cleanup supersedes its body Exit. */
export function authoringResource<A, B, R, R2, R3>(
  acquire: Effect.Effect<A, AuthoringFailure, R>,
  use: (resource: A) => Effect.Effect<B, AuthoringFailure, R2>,
  release: (resource: A) => Effect.Effect<unknown, AuthoringFailure, R3>,
): Effect.Effect<B, AuthoringFailure, R | R2 | R3> {
  return Effect.uninterruptibleMask((restore) => Effect.gen(function*() {
    const resource = yield* acquire;
    const body = yield* Effect.exit(restore(use(resource)));
    const cleanup = yield* Effect.exit(release(resource));
    if (Exit.isFailure(cleanup)) return yield* Effect.failCause(cleanup.cause);
    if (Exit.isFailure(body)) return yield* Effect.failCause(body.cause);
    return body.value;
  }));
}

/** One finite invocation for one real public Promise operation. */
export async function runAuthoring<A>(program: Effect.Effect<A, AuthoringFailure>): Promise<A> {
  const exit = await Effect.runPromiseExit(program);
  if (Exit.isSuccess(exit)) return exit.value;
  throw authoringCauseValue(exit.cause);
}
