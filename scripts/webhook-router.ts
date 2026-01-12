#!/usr/bin/env tsx
/**
 * Webhook Event Router
 * Routes GitHub webhook events to appropriate agents
 */

import { Octokit } from '@octokit/rest';

type EventType = 'issue' | 'pr' | 'push' | 'comment';

interface EventPayload {
  type: EventType;
  action: string;
  number?: number;
  title?: string;
  body?: string;
  labels?: string[];
  author?: string;
  branch?: string;
  commit?: string;
}

interface RoutingRule {
  condition: (payload: EventPayload) => boolean;
  agent: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  action: string;
}

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const REPOSITORY = process.env.GITHUB_REPOSITORY || '';
const [owner, repo] = REPOSITORY.split('/');

const octokit = GITHUB_TOKEN ? new Octokit({ auth: GITHUB_TOKEN }) : null;

const ROUTING_RULES: RoutingRule[] = [
  {
    condition: (p) => p.type === 'issue' && p.action === 'labeled' && (p.labels?.includes('🤖agent-execute') ?? false),
    agent: 'CoordinatorAgent',
    priority: 'critical',
    action: 'Execute autonomous task',
  },
  {
    condition: (p) => p.type === 'comment' && (p.body?.startsWith('/agent') ?? false),
    agent: 'CoordinatorAgent',
    priority: 'critical',
    action: 'Parse and execute command',
  },
  {
    condition: (p) => p.type === 'issue' && p.action === 'opened',
    agent: 'IssueAgent',
    priority: 'high',
    action: 'Analyze and auto-label issue',
  },
  {
    condition: (p) => p.type === 'issue' && p.action === 'assigned',
    agent: 'IssueAgent',
    priority: 'high',
    action: 'Transition to implementing state',
  },
  {
    condition: (p) => p.type === 'issue' && p.action === 'closed',
    agent: 'IssueAgent',
    priority: 'medium',
    action: 'Transition to done state',
  },
  {
    condition: (p) => p.type === 'pr' && p.action === 'opened',
    agent: 'ReviewAgent',
    priority: 'high',
    action: 'Run quality checks',
  },
  {
    condition: (p) => p.type === 'pr' && p.action === 'ready_for_review',
    agent: 'ReviewAgent',
    priority: 'high',
    action: 'Run quality checks and request review',
  },
  {
    condition: (p) => p.type === 'push' && p.branch === 'main',
    agent: 'DeploymentAgent',
    priority: 'medium',
    action: 'Deploy to production',
  },
];

class WebhookEventRouter {
  async route(payload: EventPayload): Promise<void> {
    console.log(`\n📥 Received ${payload.type} event: ${payload.action}`);

    const matchedRules = ROUTING_RULES.filter((rule) => rule.condition(payload));

    if (matchedRules.length === 0) {
      console.log(`⚠️  No routing rules matched for this event`);
      return;
    }

    const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    matchedRules.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

    console.log(`\n✅ Matched ${matchedRules.length} routing rule(s):`);

    for (const rule of matchedRules) {
      console.log(`\n🎯 Routing to ${rule.agent}`);
      console.log(`   Priority: ${rule.priority}`);
      console.log(`   Action: ${rule.action}`);

      if (payload.number && octokit) {
        await this.createRoutingComment(payload.number, rule.agent, rule.action);
      }
    }
  }

  private async createRoutingComment(issueNumber: number, agent: string, action: string): Promise<void> {
    if (!octokit || !owner || !repo) return;

    const body = `## 🤖 Event Router

**Agent**: ${agent}
**Action**: ${action}
**Timestamp**: ${new Date().toISOString()}

---
*Automated by Webhook Event Router*`;

    try {
      await octokit.issues.createComment({
        owner,
        repo,
        issue_number: issueNumber,
        body,
      });
      console.log(`📝 Created routing comment on #${issueNumber}`);
    } catch (error) {
      console.error(`⚠️  Failed to create comment:`, error);
    }
  }
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.error('Usage: webhook-router.ts <event-type> <action> [args...]');
    process.exit(1);
  }

  const [eventType, action, ...rest] = args;

  const payload: EventPayload = {
    type: eventType as EventType,
    action,
  };

  if (eventType === 'issue' || eventType === 'pr' || eventType === 'comment') {
    payload.number = parseInt(rest[0], 10);
    payload.title = process.env.ISSUE_TITLE || process.env.PR_TITLE;
    payload.body = process.env.COMMENT_BODY;
    payload.author = process.env.COMMENT_AUTHOR || rest[1];

    const labelsJson = process.env.ISSUE_LABELS;
    if (labelsJson) {
      try {
        const labels = JSON.parse(labelsJson);
        payload.labels = labels.map((l: any) => l.name);
      } catch {
        console.warn('⚠️  Failed to parse ISSUE_LABELS');
      }
    }
  } else if (eventType === 'push') {
    payload.branch = rest[0];
    payload.commit = rest[1];
  }

  const router = new WebhookEventRouter();
  await router.route(payload);
}

main().catch((error) => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});

export { WebhookEventRouter, EventPayload };
