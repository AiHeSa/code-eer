export default {
  id: 'dsh', skillRoot: '.agents/skills', guidanceFile: 'AGENTS.md',
  mode: 'advisory', automaticReview: false,
  compatibility: '@deepseek-ai/dsh-skill-filesystem 0.2.2-rc.1; default project-agents root',
  prerequisites: ['dsh-skill', 'dsh-skill-filesystem', 'dsh-tool-skill', 'dsh-agent-instructions'],
};
