import { definePlugin } from 'nitro';
import { initConfig } from '../config/config.ts';
import { initIntegrationsConfig } from '../config/integrations-config.ts';
import { initTranslations } from '../config/translations.ts';
import { initDatabaseSchema } from '../db/index.ts';
import { logger } from '../logger.ts';

export default definePlugin(async () => {
  const integrationsConfigPath = initIntegrationsConfig();
  const configPath = initConfig();
  const translationsPath = initTranslations();
  await initDatabaseSchema();

  logger.info(
    { integrationsConfigPath, configPath, translationsPath },
    'Initialized config files and database schema on startup',
  );
});
