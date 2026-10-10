import { ApiError } from '../../errors';
import { createSocketClient, type TopicSubscription } from '../socketClient';
import { createFakeSocket, type FakeChannel, type FakeSocket } from '../testing/fakeSocket';

const TOPIC = 'planning:account-1';

async function setupJoined() {
  let socket!: FakeSocket;
  const client = createSocketClient({
    url: 'wss://api.example.test/socket',
    createSocket: (url, options) => {
      socket = createFakeSocket(url, options);
      return socket;
    },
    getAccessToken: async () => 'access-1',
    refreshTokens: jest.fn(),
    subscribeToAccessToken: () => () => {},
  });
  await client.connect();
  socket.open();
  const subscription = client.joinTopic(TOPIC);
  const channel: FakeChannel = socket.channels[0];
  channel.replyOk();
  return { subscription, channel };
}

describe('TopicSubscription.push', () => {
  let subscription: TopicSubscription;
  let channel: FakeChannel;

  beforeEach(async () => {
    ({ subscription, channel } = await setupJoined());
  });

  it('sends the event with its payload and resolves with the ok reply', async () => {
    const reply = subscription.push('start_planning', { rangeFrom: '2030-01-01' });

    expect(channel.pushes).toHaveLength(1);
    expect(channel.pushes[0].event).toBe('start_planning');
    expect(channel.pushes[0].payload).toEqual({ rangeFrom: '2030-01-01' });

    channel.pushes[0].replyOk({ sessionId: 's-1', status: 'active' });

    await expect(reply).resolves.toEqual({ sessionId: 's-1', status: 'active' });
  });

  it('rejects with the ApiError of an error envelope, details included', async () => {
    const reply = subscription.push('start_planning', {});

    channel.pushes[0].replyError({
      error: {
        code: 'planning_range_locked',
        message: 'locked',
        details: { ownerName: 'Ana Peer' },
      },
    });

    const error: unknown = await reply.catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      code: 'planning_range_locked',
      message: 'locked',
      details: { ownerName: 'Ana Peer' },
    });
  });

  it('rejects with unknown_error when the error reply is not an envelope', async () => {
    const reply = subscription.push('start_planning', {});

    channel.pushes[0].replyError({ reason: 'crashed' });

    await expect(reply).rejects.toMatchObject({ code: 'unknown_error' });
  });

  it('rejects with timeout when the server does not answer in time', async () => {
    const reply = subscription.push('start_planning', {});

    channel.pushes[0].timeout();

    await expect(reply).rejects.toMatchObject({ code: 'timeout' });
  });

  it('rejects at once after the subscription has been left', async () => {
    subscription.leave();

    await expect(subscription.push('start_planning', {})).rejects.toMatchObject({
      code: 'network_error',
    });
    expect(channel.pushes).toHaveLength(0);
  });
});

describe('TopicSubscription.on', () => {
  let subscription: TopicSubscription;
  let channel: FakeChannel;

  beforeEach(async () => {
    ({ subscription, channel } = await setupJoined());
  });

  it('delivers the payload of the event to its handler only', () => {
    const handler = jest.fn();
    const other = jest.fn();
    subscription.on('proposal_ready', handler);
    subscription.on('generation_error', other);

    channel.emit('proposal_ready', { proposalId: 'p-1' });

    expect(handler).toHaveBeenCalledWith({ proposalId: 'p-1' });
    expect(other).not.toHaveBeenCalled();
  });

  it('stops delivering once unsubscribed, and leaves other handlers of the event alone', () => {
    const first = jest.fn();
    const second = jest.fn();
    const unsubscribe = subscription.on('proposal_ready', first);
    subscription.on('proposal_ready', second);

    unsubscribe();
    channel.emit('proposal_ready', {});

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('keeps the handlers across the rejoin that follows a reconnect', () => {
    const handler = jest.fn();
    subscription.on('proposal_ready', handler);

    channel.replyOk();
    channel.emit('proposal_ready', { n: 1 });

    expect(handler).toHaveBeenCalledTimes(1);
  });
});
