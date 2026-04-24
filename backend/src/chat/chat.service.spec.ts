import type { AppConfig } from '@app/config/schema';
import type {
  ChatMessage,
  LlmClient,
  StreamResult,
} from '@app/llm/ports/llm-client.port';
import type { PromptLoaderService } from '@app/prompts/prompt-loader.service';
import type { RetrievalService } from '@app/retrieval/retrieval.service';
import type { RetrievalHit } from '@app/retrieval/types';

import { ChatService } from './chat.service';
import type { ResolvedCitation } from './citations.schema';
import type { CitationsService } from './citations.service';
import type { SessionService } from './session.service';

function baseConfig(
  overrides: Partial<AppConfig['file']['chat']> = {},
): AppConfig {
  return {
    env: { NODE_ENV: 'test', PORT: 3000 },
    file: {
      log: { level: 'info' },
      server: { host: '0.0.0.0' },
      vector: { url: 'http://x', collection: 'test-corpus', denseSize: 3 },
      chat: {
        model: 'mock/model',
        temperature: 0.2,
        maxOutputTokens: 1024,
        refusalString: 'I do not know.',
        userName: 'tester',
        ...overrides,
      },
    },
  };
}

function mkHit(id: string, text: string, title = `paper-${id}`): RetrievalHit {
  return {
    id,
    score: 1,
    metadata: {
      sourceTitle: title,
      sourceType: 'paper',
      chunkIndex: 0,
      text,
    },
  };
}

function mockPrompts(): PromptLoaderService {
  return {
    get: jest
      .fn()
      .mockImplementation(
        (_name: string, vars: Record<string, string>) =>
          `SYSTEM[${vars['collectionName']}|${vars['userName']}|${vars['refusalString']}]`,
      ),
    list: jest.fn().mockReturnValue(['chat.system']),
  } as unknown as PromptLoaderService;
}

function mockSessions(resolvedId = 'new-session-id'): SessionService {
  return {
    recentMessages: jest.fn().mockReturnValue([]),
    appendTurn: jest.fn().mockReturnValue({
      id: resolvedId,
      title: 'x',
      createdAt: 1,
      updatedAt: 1,
    }),
  } as unknown as SessionService;
}

function mockRetrieval(hits: RetrievalHit[] = []): RetrievalService {
  return {
    topK: jest.fn().mockResolvedValue(hits),
  } as unknown as RetrievalService;
}

function mockCitations(out: ResolvedCitation[] = []): CitationsService {
  return {
    pick: jest.fn().mockResolvedValue(out),
  } as unknown as CitationsService;
}

function mockLlm(textChunks: string[] = ['hello', ' world']): LlmClient {
  const stream: StreamResult = {
    textStream: (async function* () {
      await Promise.resolve();
      for (const c of textChunks) yield c;
    })(),
    done: Promise.resolve({
      text: textChunks.join(''),
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      latencyMs: 1,
      ttftMs: 1,
      finishReason: 'stop',
    }),
  };
  return {
    generateText: jest.fn(),
    generateObject: jest.fn(),
    stream: jest.fn().mockReturnValue(stream),
  };
}

interface CapturedStreamArgs {
  system: string;
  messages: ChatMessage[];
  model: string;
  signal: AbortSignal;
  temperature: number;
  maxOutputTokens: number;
}

function capturedStreamArgs(llm: LlmClient): CapturedStreamArgs {
  return (llm.stream as jest.Mock).mock.calls[0][0] as CapturedStreamArgs;
}

describe('ChatService.startTurn', () => {
  it('throws when config.chat is missing', async () => {
    const cfg: AppConfig = {
      env: { NODE_ENV: 'test', PORT: 3000 },
      file: {
        log: { level: 'info' },
        server: { host: '0.0.0.0' },
      },
    };
    const svc = new ChatService(
      cfg,
      mockPrompts(),
      mockSessions(),
      mockRetrieval(),
      mockCitations(),
      mockLlm(),
    );
    await expect(
      svc.startTurn({
        sessionId: undefined,
        message: 'hi',
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow(/chat:/);
  });

  it('retrieves top-k for the user message and injects hits into the final user turn', async () => {
    const hits = [mkHit('a', 'chunk one'), mkHit('b', 'chunk two')];
    const retrieval = mockRetrieval(hits);
    const llm = mockLlm();
    const svc = new ChatService(
      baseConfig(),
      mockPrompts(),
      mockSessions(),
      retrieval,
      mockCitations(),
      llm,
    );
    await svc.startTurn({
      sessionId: undefined,
      message: 'question',
      signal: new AbortController().signal,
    });

    expect(retrieval.topK).toHaveBeenCalledWith('question', {
      correlationId: undefined,
      rerank: undefined,
      mmr: undefined,
    });
    const { messages } = capturedStreamArgs(llm);
    const userTurn = messages[messages.length - 1];
    expect(userTurn.role).toBe('user');
    expect(userTurn.content).toContain('[1] chunk one');
    expect(userTurn.content).toContain('[2] chunk two');
    expect(userTurn.content).toContain('User question: question');
  });

  it('renders system prompt with collectionName + userName + refusalString from config', async () => {
    const llm = mockLlm();
    const svc = new ChatService(
      baseConfig({ userName: 'ada', refusalString: 'dunno' }),
      mockPrompts(),
      mockSessions(),
      mockRetrieval(),
      mockCitations(),
      llm,
    );
    await svc.startTurn({
      sessionId: undefined,
      message: 'hi',
      signal: new AbortController().signal,
    });
    const { system } = capturedStreamArgs(llm);
    expect(system).toContain('test-corpus');
    expect(system).toContain('ada');
    expect(system).toContain('dunno');
  });

  it('includes session history when sessionId is provided', async () => {
    const sessions = mockSessions();
    (sessions.recentMessages as jest.Mock).mockReturnValue([
      {
        id: '1',
        sessionId: 's',
        role: 'user',
        content: 'earlier Q',
        citations: undefined,
        createdAt: 1,
      },
      {
        id: '2',
        sessionId: 's',
        role: 'assistant',
        content: 'earlier A',
        citations: undefined,
        createdAt: 2,
      },
    ]);
    const llm = mockLlm();
    const svc = new ChatService(
      baseConfig(),
      mockPrompts(),
      sessions,
      mockRetrieval(),
      mockCitations(),
      llm,
    );
    await svc.startTurn({
      sessionId: 's',
      message: 'follow-up',
      signal: new AbortController().signal,
    });
    const { messages } = capturedStreamArgs(llm);
    expect(messages).toHaveLength(3);
    expect(messages[0]).toEqual({ role: 'user', content: 'earlier Q' });
    expect(messages[1]).toEqual({ role: 'assistant', content: 'earlier A' });
    expect(messages[2].role).toBe('user');
    expect(messages[2].content).toContain('User question: follow-up');
  });

  it('skips history lookup when sessionId is undefined', async () => {
    const sessions = mockSessions();
    const llm = mockLlm();
    const svc = new ChatService(
      baseConfig(),
      mockPrompts(),
      sessions,
      mockRetrieval(),
      mockCitations(),
      llm,
    );
    await svc.startTurn({
      sessionId: undefined,
      message: 'first',
      signal: new AbortController().signal,
    });
    expect(sessions.recentMessages).not.toHaveBeenCalled();
  });

  it('threads AbortSignal into the LLM stream call', async () => {
    const llm = mockLlm();
    const svc = new ChatService(
      baseConfig(),
      mockPrompts(),
      mockSessions(),
      mockRetrieval(),
      mockCitations(),
      llm,
    );
    const ctrl = new AbortController();
    await svc.startTurn({
      sessionId: undefined,
      message: 'x',
      signal: ctrl.signal,
    });
    expect(capturedStreamArgs(llm).signal).toBe(ctrl.signal);
  });

  it('emits model + temperature + maxOutputTokens from config', async () => {
    const llm = mockLlm();
    const svc = new ChatService(
      baseConfig({
        model: 'foo/bar:free',
        temperature: 0.5,
        maxOutputTokens: 512,
      }),
      mockPrompts(),
      mockSessions(),
      mockRetrieval(),
      mockCitations(),
      llm,
    );
    await svc.startTurn({
      sessionId: undefined,
      message: 'x',
      signal: new AbortController().signal,
    });
    const args = capturedStreamArgs(llm);
    expect(args.model).toBe('foo/bar:free');
    expect(args.temperature).toBe(0.5);
    expect(args.maxOutputTokens).toBe(512);
  });

  it('complete() persists the turn via SessionService.appendTurn and returns enriched citations', async () => {
    const sessions = mockSessions('resolved-id');
    const cites: ResolvedCitation[] = [
      {
        n: 1,
        sourceTitle: 'Reflexion',
        chunkIndex: 0,
        paperId: 'p-1',
      },
    ];
    const svc = new ChatService(
      baseConfig(),
      mockPrompts(),
      sessions,
      mockRetrieval(),
      mockCitations(cites),
      mockLlm(),
    );
    const handle = await svc.startTurn({
      sessionId: undefined,
      message: 'q',
      signal: new AbortController().signal,
    });
    const result = await handle.complete('full answer');
    expect(sessions.appendTurn).toHaveBeenCalledWith(
      undefined,
      'q',
      'full answer',
      cites,
    );
    expect(result.citations).toEqual(cites);
    expect(handle.sessionId).toBe('resolved-id');
  });

  it('handle.sessionId echoes the client-supplied id pre-completion', async () => {
    const svc = new ChatService(
      baseConfig(),
      mockPrompts(),
      mockSessions(),
      mockRetrieval(),
      mockCitations(),
      mockLlm(),
    );
    const handle = await svc.startTurn({
      sessionId: 'client-id',
      message: 'q',
      signal: new AbortController().signal,
    });
    expect(handle.sessionId).toBe('client-id');
  });
});
