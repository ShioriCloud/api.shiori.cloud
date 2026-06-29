import { ExecutionContext, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BotAuthGuard } from './bot-auth.guard';

describe('BotAuthGuard', () => {
  const createContext = (headers: Record<string, string>): ExecutionContext =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({ headers }),
      }),
    }) as ExecutionContext;

  it('allows matching x-bot-token', () => {
    const config = { get: jest.fn().mockReturnValue('secret-token') } as unknown as ConfigService;
    const guard = new BotAuthGuard(config);

    expect(
      guard.canActivate(createContext({ 'x-bot-token': 'secret-token' })),
    ).toBe(true);
  });

  it('rejects missing header', () => {
    const config = { get: jest.fn().mockReturnValue('secret-token') } as unknown as ConfigService;
    const guard = new BotAuthGuard(config);

    expect(() => guard.canActivate(createContext({}))).toThrow(UnauthorizedException);
  });

  it('rejects wrong token', () => {
    const config = { get: jest.fn().mockReturnValue('secret-token') } as unknown as ConfigService;
    const guard = new BotAuthGuard(config);

    expect(() =>
      guard.canActivate(createContext({ 'x-bot-token': 'wrong' })),
    ).toThrow(UnauthorizedException);
  });

  it('fails when BOT_API_TOKEN is not configured', () => {
    const config = { get: jest.fn().mockReturnValue('') } as unknown as ConfigService;
    const guard = new BotAuthGuard(config);

    expect(() =>
      guard.canActivate(createContext({ 'x-bot-token': 'anything' })),
    ).toThrow(ServiceUnavailableException);
  });
});
