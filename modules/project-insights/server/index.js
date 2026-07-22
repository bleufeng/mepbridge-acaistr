module.exports = function createProjectInsightsModule(context, manifest, commands) {
  return {
    async getCommands() {
      return commands;
    },

    async isAvailable() {
      return true;
    },

    async execute(commandName) {
      if (commandName !== 'project-insights.get-summary') {
        return {
          success: false,
          error: `Unsupported module command: ${commandName}`,
          errorType: 'MODULE_COMMAND_NOT_FOUND',
        };
      }

      const project = await context.executeArchicad('MEPBridge.GetProjectInfo', {});
      if (!project.success) {
        return {
          success: false,
          error: project.error || 'Unable to read project information',
          errorType: project.errorType || 'ARCHICAD_QUERY_FAILED',
        };
      }

      const stories = await context.executeArchicad('MEPBridge.GetStories', {});
      if (!stories.success) {
        return {
          success: false,
          error: stories.error || 'Unable to read project stories',
          errorType: stories.errorType || 'ARCHICAD_QUERY_FAILED',
        };
      }

      return {
        success: true,
        data: {
          moduleId: manifest.id,
          generatedAt: new Date().toISOString(),
          project: project.data,
          stories: stories.data,
        },
      };
    },
  };
};
