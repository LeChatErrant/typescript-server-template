import { Prisma, PrismaClient } from '@prisma/client';
import logger from './appLogger';
import { config, MODES } from './appConfig';

const db = new PrismaClient({
  log: [
    {
      emit: 'event',
      level: 'info',
    },
    {
      emit: 'event',
      level: 'warn',
    },
  ],
});

db.$on('info', (e) => logger.info(e.message));
db.$on('warn', (e) => logger.warn(e.message));

/**
 * Array of IDs of resources generated by the app in `TEST` mode for each models
 * It allows to track and delete only test resources, thanks to the following middleware
 */
const testResources = Object
  .values(Prisma.ModelName)
  .reduce((acc, val) => ({
    ...acc,
    [val]: [],
  }), {} as {[key in Prisma.ModelName]: string[]});

/**
 * This middleware stores every resources IDs into `testResources`
 * when the app is running in `TEST` mode
 *
 * It allows to track and delete only the resources created by tests,
 * to avoid harming the rest of the database
 */
if (config.mode === MODES.TEST) {
  logger.info('Using test-resources garbage collector prisma middleware');
  db.$use(async (params, next) => {
    const result = await next(params);
    const { action, model } = params as {
      model?: Prisma.ModelName;
      action: Prisma.PrismaAction;
    };

    if (!model) {
      return result;
    }

    if (action === 'create' || action === 'upsert') {
      const { id } = result;
      if (!id) {
        logger.error(
          `Can't find ID field on ${model}. The resource won't be saved into the test
          garbage collector and need to be manually deleted`,
        );
      } else {
        testResources[model].push(id);
      }
    }

    return result;
  });
}

export async function clearTestResources() {
  await Promise.all(Object
    .entries(testResources)
    .map(async ([model, ids]) => {
      // eslint-disable-next-line @typescript-eslint/ban-ts-ignore
      // @ts-ignore
      const { count } = await db[model.toLowerCase()].deleteMany({
        where: { id: { in: ids } },
      });
      logger.info(`Deleted ${count} ${model}`);
      ids.splice(0, ids.length);
    }));
}

export default db;
