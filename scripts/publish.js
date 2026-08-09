import { execSync } from 'child_process';
import { readFile } from 'fs/promises';
import path from 'path';

async function validateAndPackage() {
  console.log('⚡ Starting Titao Distribution & Publish Validation...\n');

  try {
    // 1. Build TypeScript project
    console.log('📦 Step 1: Compiling TypeScript code (npm run build)...');
    execSync('npm run build', { stdio: 'inherit' });
    console.log('   ✅ Build clean with 0 errors.\n');

    // 2. Run Vitest test suite
    console.log('🧪 Step 2: Running Vitest automated test suite...');
    execSync('npx vitest run', { stdio: 'inherit' });
    console.log('   ✅ All unit & integration tests passed.\n');

    // 3. Verify dist/index.js entry point shebang
    console.log('🔍 Step 3: Verifying binary entry point...');
    const entryContent = await readFile(path.resolve('./dist/index.js'), 'utf-8');
    if (!entryContent.startsWith('#!/usr/bin/env node')) {
      throw new Error('dist/index.js is missing node shebang #!/usr/bin/env node');
    }
    console.log('   ✅ Binary shebang verified.\n');

    // 4. Run npm pack dry-run
    console.log('📦 Step 4: Running npm pack dry-run...');
    execSync('npm pack --dry-run', { stdio: 'inherit' });
    console.log('\n🎉 Step 5: Titao is 100% production-ready for npm release!');
  } catch (err) {
    console.error(`❌ Validation failed: ${err.message}`);
    process.exit(1);
  }
}

validateAndPackage();
