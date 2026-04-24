/**
 * Five pointwise + pairwise judges for the Step-13 eval harness.
 *
 * All judges run on local Ollama gemma2:27b via PREFIX_LLM_CLIENT — family
 * distinct from the chat model (Nvidia Nemotron) to kill self-preference
 * bias. Prompt templates live in backend/prompts/judge.*.md.
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';

import { APP_CONFIG, type AppConfig } from '@app/config/schema';
import {
  PREFIX_LLM_CLIENT,
  type LlmClient,
} from '@app/llm/ports/llm-client.port';
import { PromptLoaderService } from '@app/prompts/prompt-loader.service';

const ScoreSchema05 = z.object({
  score: z.number().int().min(0).max(5),
  reasoning: z.string(),
});

// Spec-aligned 1–5 scale for relevance + groundedness.
const ScoreSchema15 = z.object({
  score: z.number().int().min(1).max(5),
  reasoning: z.string(),
});

export type PointScore05 = z.infer<typeof ScoreSchema05>;
export type PointScore15 = z.infer<typeof ScoreSchema15>;
export type PairwiseOutcome = 'A' | 'B' | 'T';

@Injectable()
export class JudgeService {
  private readonly logger = new Logger(JudgeService.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(PromptLoaderService) private readonly prompts: PromptLoaderService,
    @Inject(PREFIX_LLM_CLIENT) private readonly llm: LlmClient,
  ) {}

  /**
   * Pairwise answer relevance. Symmetric-ordering wrapper: runs A-vs-B AND
   * B-vs-A; returns 'A' only when both orderings agree A is better, likewise
   * for 'B'. Disagreement → 'T' (tie). Kills position bias.
   */
  async pairwiseRelevance(
    question: string,
    answerA: string,
    answerB: string,
  ): Promise<PairwiseOutcome> {
    const forward = await this.singlePairwise(question, answerA, answerB);
    const reverse = await this.singlePairwise(question, answerB, answerA);
    if (forward === 'A' && reverse === 'B') return 'A';
    if (forward === 'B' && reverse === 'A') return 'B';
    return 'T';
  }

  async relevance(
    question: string,
    expectedAnswer: string,
    candidateAnswer: string,
  ): Promise<PointScore15> {
    const prompt = this.prompts.get('judge.relevance', {
      question,
      expectedAnswer,
      candidateAnswer,
    });
    const res = await this.llm.generateObject({
      model: this.requireJudgeModel(),
      role: 'judge-pointwise',
      prompt,
      schema: ScoreSchema15,
      temperature: 0,
      maxOutputTokens: 200,
    });
    return res.object;
  }

  async groundedness(
    question: string,
    context: string,
    candidateAnswer: string,
  ): Promise<PointScore15> {
    const prompt = this.prompts.get('judge.groundedness', {
      question,
      context,
      candidateAnswer,
    });
    const res = await this.llm.generateObject({
      model: this.requireJudgeModel(),
      role: 'judge-pointwise',
      prompt,
      schema: ScoreSchema15,
      temperature: 0,
      maxOutputTokens: 200,
    });
    return res.object;
  }

  async faithfulness(
    question: string,
    context: string,
    candidateAnswer: string,
  ): Promise<PointScore05> {
    const prompt = this.prompts.get('judge.faithfulness', {
      question,
      context,
      candidateAnswer,
    });
    const res = await this.llm.generateObject({
      model: this.requireJudgeModel(),
      role: 'judge-pointwise',
      prompt,
      schema: ScoreSchema05,
      temperature: 0,
      maxOutputTokens: 200,
    });
    return res.object;
  }

  async completeness(
    question: string,
    expectedAnswer: string,
    candidateAnswer: string,
  ): Promise<PointScore05> {
    const prompt = this.prompts.get('judge.completeness', {
      question,
      expectedAnswer,
      candidateAnswer,
    });
    const res = await this.llm.generateObject({
      model: this.requireJudgeModel(),
      role: 'judge-pointwise',
      prompt,
      schema: ScoreSchema05,
      temperature: 0,
      maxOutputTokens: 200,
    });
    return res.object;
  }

  private async singlePairwise(
    question: string,
    answerA: string,
    answerB: string,
  ): Promise<PairwiseOutcome> {
    const prompt = this.prompts.get('judge-relevance-pairwise', {
      question,
      answerA,
      answerB,
    });
    const res = await this.llm.generateText({
      model: this.requireJudgeModel(),
      role: 'judge-pairwise',
      prompt,
      temperature: 0,
      maxOutputTokens: 4,
    });
    const t = res.text.trim().toUpperCase().slice(0, 1);
    if (t === 'A' || t === 'B' || t === 'T') return t;
    this.logger.warn(`pairwise judge returned "${res.text}" — coercing to T`);
    return 'T';
  }

  private requireJudgeModel(): string {
    const model = this.config.file.eval?.judgeModel;
    if (!model) {
      throw new Error('Missing eval.judgeModel in config.yaml');
    }
    return model;
  }
}
