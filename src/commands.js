import { fileToDirectory, directoryToFile } from './migrate.js';

export default {
  'db:migrate-to-directory': {
    description: 'Migrate DB from single file to directory mode',
    bootstrap: true,
    run: async () => {
      await fileToDirectory();
      console.log('DB migration to directory mode complete.');
    }
  },
  'db:migrate-to-file': {
    description: 'Migrate DB from directory mode to single file',
    bootstrap: true,
    run: async () => {
      await directoryToFile();
      console.log('DB migration to file mode complete.');
    }
  }
};
