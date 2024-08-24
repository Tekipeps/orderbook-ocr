const fs = require("fs").promises;
const path = require("path");
const sharp = require("sharp");

const inputDir = "inputs";
const outputDir = "outputs";
const topCrop = 150;

async function processImage(inputPath, outputPath) {
  try {
    const image = sharp(inputPath);
    const metadata = await image.metadata();

    if (!metadata.width || !metadata.height) {
      throw new Error("Unable to get image dimensions");
    }

    const newHeight = Math.max(1, metadata.height - topCrop);

    await image
      .extract({
        top: topCrop,
        left: 0,
        width: metadata.width,
        height: newHeight,
      })
      .toFile(outputPath);

    console.log(`Successfully processed ${path.basename(inputPath)}`);
  } catch (error) {
    console.error(
      `Error processing ${path.basename(inputPath)}: ${error.message}`,
    );
  }
}

async function cropAllImages() {
  try {
    await fs.mkdir(outputDir, { recursive: true });

    const files = await fs.readdir(inputDir);
    const pngFiles = files.filter(
      (file) => path.extname(file).toLowerCase() === ".png",
    );

    for (const file of pngFiles) {
      const inputPath = path.join(inputDir, file);
      const outputPath = path.join(outputDir, file);
      await processImage(inputPath, outputPath);
    }

    console.log("All images have been processed.");
  } catch (error) {
    console.error(`An error occurred: ${error.message}`);
  }
}

module.exports = {
  cropAllImages,
};
