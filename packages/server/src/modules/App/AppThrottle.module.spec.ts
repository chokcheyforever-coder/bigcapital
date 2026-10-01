import { ExecutionContext } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { skipAuthThrottle } from './AppThrottle.module';

@Throttle({ auth: {} })
class SignInController {
  signin() {}
}

class AccountsController {
  list() {}
  @Throttle({ auth: { limit: 5, ttl: 60000 } })
  sensitive() {}
}

const context = (cls: any, handler: string) =>
  ({ getClass: () => cls, getHandler: () => cls.prototype[handler] }) as unknown as ExecutionContext;

describe('skipAuthThrottle', () => {
  it('applies the auth limit to controllers that opt in', () => {
    expect(skipAuthThrottle(context(SignInController, 'signin'))).toBe(false);
  });

  it('applies the auth limit to a route that opts in', () => {
    expect(skipAuthThrottle(context(AccountsController, 'sensitive'))).toBe(false);
  });

  it('skips the auth limit everywhere else', () => {
    expect(skipAuthThrottle(context(AccountsController, 'list'))).toBe(true);
  });
});
