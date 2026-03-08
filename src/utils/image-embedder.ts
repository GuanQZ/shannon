/**
 * Image Embedder Utility
 * 将markdown中的图片路径引用替换为base64嵌入
 */

import { fs, path } from 'zx';

/**
 * Convert image file to base64 data URL
 * 将图片文件转换为base64 data URL
 */
async function imageToBase64(imagePath: string): Promise<string | null> {
  try {
    const ext = path.extname(imagePath).toLowerCase();
    const mimeTypes: Record<string, string> = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.svg': 'image/svg+xml',
    };

    const mimeType = mimeTypes[ext];
    if (!mimeType) {
      console.warn(`⚠️ Unknown image type: ${ext}`);
      return null;
    }

    const buffer = await fs.readFile(imagePath);
    const base64 = buffer.toString('base64');
    return `data:${mimeType};base64,${base64}`;
  } catch (error) {
    console.error(`❌ Failed to read image ${imagePath}: ${error}`);
    return null;
  }
}

/**
 * Find all image references in markdown content
 * 查找markdown中所有的图片路径引用
 */
function findImageReferences(content: string): string[] {
  // Match markdown image syntax: ![alt](path)
  const regex = /!\[([^\]]*)\]\(([^)]+)\)/g;
  const references: string[] = [];
  let match;

  while ((match = regex.exec(content)) !== null) {
    const imagePath = match[2];
    // Only handle relative paths (not URLs)
    if (imagePath && !imagePath.startsWith('http://') && !imagePath.startsWith('https://') && !imagePath.startsWith('data:')) {
      references.push(imagePath);
    }
  }

  return references;
}

/**
 * Embed images in markdown file
 * 将图片嵌入markdown文件
 */
export async function embedImagesInMarkdown(markdownPath: string): Promise<number> {
  // Always use the markdown file's directory as the primary base
  const markdownDir = path.dirname(markdownPath);

  // Read markdown file
  const content = await fs.readFile(markdownPath, 'utf8');

  // Find all image references
  const imageRefs = findImageReferences(content);

  if (imageRefs.length === 0) {
    return 0;
  }

  console.log(`📷 Found ${imageRefs.length} image reference(s) in ${path.basename(markdownPath)}`);

  let modifiedContent = content;
  let embeddedCount = 0;

  for (const imageRef of imageRefs) {
    // Screenshot locations:
    // 1. From deliverables/: ../../screenshots/xxx.png -> repos/xxx/screenshots/
    // 2. Relative to markdown: ./screenshots/xxx.png -> deliverables/screenshots/

    const possiblePaths: string[] = [
      // Path 1: From deliverables/chinese/reporting/ back 3 levels to repo root, then screenshots/
      // e.g., deliverables/chinese/reporting/ -> deliverables/chinese/ -> deliverables/ -> {repo}/
      path.resolve(markdownDir, '..', '..', '..', 'screenshots', path.basename(imageRef)),
      // Path 2: Relative to markdown file (deliverables/chinese/screenshots/)
      path.resolve(markdownDir, imageRef),
      // Path 3: From deliverables/ back 2 levels (for deliverables/vulnerability/ and deliverables/exploitation/)
      path.resolve(markdownDir, '..', '..', 'screenshots', path.basename(imageRef)),
      // Path 4: At repo root (current location for Playwright MCP screenshots)
      path.resolve(markdownDir, '..', '..', '..', path.basename(imageRef)),
    ].filter(Boolean);

    let imagePath: string | null = null;
    let foundLocation = '';
    for (const p of possiblePaths) {
      if (await fs.pathExists(p)) {
        imagePath = p;
        foundLocation = p;
        break;
      }
    }

    if (!imagePath) {
      console.warn(`⚠️ Image not found: ${imageRef}`);
      continue;
    }

    // Check if screenshot is in deliverables (preferred) vs repo root
    const isInDeliverables = foundLocation.includes('/deliverables/');
    const locationNote = isInDeliverables ? '(deliverables)' : '(repo root)';

    const base64 = await imageToBase64(imagePath);
    if (!base64) {
      continue;
    }

    // Replace the path reference with base64
    const regex = new RegExp(`!\\[([^\\]]*)\\]\\(${escapeRegex(imageRef)}\\)`, 'g');
    modifiedContent = modifiedContent.replace(regex, `![$1](${base64})`);
    embeddedCount++;

    console.log(`   ✅ Embedded: ${imageRef} ${locationNote}`);
  }

  // Write back if changes were made
  if (embeddedCount > 0) {
    await fs.writeFile(markdownPath, modifiedContent, 'utf8');
  }

  return embeddedCount;
}

/**
 * Collect all image references from markdown files
 * 收集所有 markdown 文件中的图片引用
 */
async function collectAllImageRefs(directoryPath: string): Promise<Set<string>> {
  const refs = new Set<string>();
  const files = await fs.readdir(directoryPath);

  for (const file of files) {
    const fullPath = path.join(directoryPath, file);
    const stat = await fs.stat(fullPath);
    if (stat.isDirectory()) {
      const subRefs = await collectAllImageRefs(fullPath);
      subRefs.forEach(r => refs.add(r));
    } else if (file.endsWith('.md')) {
      const content = await fs.readFile(fullPath, 'utf8');
      const fileRefs = findImageReferences(content);
      fileRefs.forEach(r => refs.add(r));
    }
  }

  return refs;
}

/**
 * Embed images in all markdown files in a directory
 * 批量处理目录下的所有markdown文件
 */
export async function embedImagesInDirectory(
  directoryPath: string
): Promise<{ success: number; failed: number }> {
  let success = 0;
  let failed = 0;

  // Ensure directory exists
  if (!(await fs.pathExists(directoryPath))) {
    console.error(`❌ Directory not found: ${directoryPath}`);
    return { success: 0, failed: 0 };
  }

  // Phase 1: Find all markdown files and collect image references
  const files = await fs.readdir(directoryPath);
  const mdFiles: string[] = [];
  const allImageRefs = new Set<string>();

  for (const file of files) {
    const fullPath = path.join(directoryPath, file);
    const stat = await fs.stat(fullPath);
    if (stat.isDirectory()) {
      // Recursively process subdirectories
      const subResult = await embedImagesInDirectory(fullPath);
      success += subResult.success;
      failed += subResult.failed;
      // Also collect refs from subdirs
      const subRefs = await collectAllImageRefs(fullPath);
      subRefs.forEach(r => allImageRefs.add(r));
    } else if (file.endsWith('.md')) {
      mdFiles.push(fullPath);
      const content = await fs.readFile(fullPath, 'utf8');
      const fileRefs = findImageReferences(content);
      fileRefs.forEach(r => allImageRefs.add(r));
    }
  }

  console.log(`📁 Processing ${mdFiles.length} markdown file(s) in ${directoryPath}`);
  console.log(`🔗 Found ${allImageRefs.size} unique image reference(s)`);

  for (const file of mdFiles) {
    try {
      const count = await embedImagesInMarkdown(file);
      if (count > 0) {
        success++;
      }
    } catch (error) {
      console.error(`❌ Failed to process ${file}: ${error}`);
      failed++;
    }
  }

  return { success, failed };
}

/**
 * Escape special regex characters
 * 转义正则表达式特殊字符
 */
function escapeRegex(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// CLI execution
if (import.meta.url === `file://${process.argv[1]}`) {
  const targetPath = process.argv[2] as string;

  if (!targetPath) {
    console.log('Usage:');
    console.log('  node dist/utils/image-embedder.js <markdown-file> [image-base-dir]');
    console.log('  node dist/utils/image-embedder.js <directory> [image-base-dir]');
    process.exit(1);
  }

  async function main() {
    const stats = await fs.stat(targetPath as string);

    if (stats.isDirectory()) {
      const result = await embedImagesInDirectory(targetPath);
      console.log(`\n📊 Summary: ${result.success} files processed, ${result.failed} failed`);
    } else {
      const count = await embedImagesInMarkdown(targetPath);
      console.log(`\n📊 Summary: ${count} image(s) embedded`);
    }
  }

  main().catch(console.error);
}
