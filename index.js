const fs = require("fs/promises");
const path = require("path");
const { createWorker } = require("tesseract.js");
const { cropAllImages } = require("./crop");
const { spawn } = require("child_process");

async function deleteFilesInDirectory(directory) {
  try {
    const files = await fs.readdir(directory);
    for (const file of files) {
      await fs.unlink(path.join(directory, file));
    }
    console.log(`All files deleted in ${directory}`);
  } catch (error) {
    if (error.code === "ENOENT") {
      console.log(`Directory ${directory} does not exist. Creating it.`);
      await fs.mkdir(directory, { recursive: true });
    } else {
      throw error;
    }
  }
}

async function extractFrames(inputFile, outputDir, fps = 10) {
  // Ensure the input file is an absolute path
  const absoluteInputPath = path.resolve(inputFile);

  // Create the output pattern
  const outputPattern = path.join(outputDir, "%d.png");

  // Construct the FFmpeg command
  const ffmpegArgs = [
    "-i",
    absoluteInputPath,
    "-vf",
    `fps=${fps}`,
    outputPattern,
  ];

  // Ensure the output directory exists
  await fs.mkdir(outputDir, { recursive: true });

  // Spawn the FFmpeg process
  const ffmpeg = spawn("ffmpeg", ffmpegArgs);

  return new Promise((resolve, reject) => {
    ffmpeg.stdout.on("data", (data) => {
      console.log(`stdout: ${data}`);
    });

    ffmpeg.stderr.on("data", (data) => {
      console.error(`stderr: ${data}`);
    });

    ffmpeg.on("close", (code) => {
      if (code === 0) {
        console.log("Frame extraction completed successfully");
        resolve();
      } else {
        console.error(`FFmpeg process exited with code ${code}`);
        reject(new Error(`FFmpeg process exited with code ${code}`));
      }
    });
  });
}

function addDecimalFromEnd(number) {
  // Convert the number to a string
  let numString = number.toString();

  // Calculate the position to insert the decimal point
  let decimalPosition = numString.length - 2;

  // Insert the decimal point
  let result =
    numString.slice(0, decimalPosition) +
    "." +
    numString.slice(decimalPosition);

  // Convert back to a number and return
  return parseFloat(result);
}

function cleanText(text) {
  const lines = text.split("\n");
  if (!lines[0].includes("ORDERS")) return null;
  let currentLine = 1;
  const ob = [];
  while (
    currentLine < lines.length &&
    !lines[currentLine].startsWith("Total")
  ) {
    const parts = lines[currentLine].split(/\s+/);
    if (parts.length >= 6) {
      const [
        bidPrice,
        bidOrders,
        bidQuantity,
        askPrice,
        askOrders,
        askQuantity,
      ] = parts;
      ob.push({
        bidPrice: addDecimalFromEnd(parseFloat(bidPrice)),
        bidOrders: parseInt(bidOrders),
        bidQuantity: parseInt(bidQuantity),
        askPrice: addDecimalFromEnd(parseFloat(askPrice)),
        askOrders: parseInt(askOrders),
        askQuantity: parseInt(askQuantity),
      });
    }
    currentLine++;
  }

  // Extract totals
  const totalsLine = lines[currentLine];
  const [bidTotal, askTotal] = totalsLine
    .split("Total")
    .slice(1)
    .map((s) => parseInt(s.trim().replace(/,/g, "")));

  // Extract bottom data
  const bottomData = {};
  for (let i = currentLine + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith("Open")) {
      const [open, high] = line
        .split(" High ")
        .map((s) => parseFloat(s.trim().split(" ").pop()));
      bottomData.open = open;
      bottomData.high = high;
    } else if (line.includes("Prev. Close")) {
      const [low, prevClose] = line
        .split(" Prev. Close ")
        .map((s) => parseFloat(s.split(" ").pop()));
      bottomData.low = low;
      bottomData.prevClose = prevClose;
    } else if (line.startsWith("Volume")) {
      const [volume, avgPrice] = line
        .split(" Avg. price ")
        .map((s) => parseFloat(s.trim().split(" ").pop()));

      bottomData.volume = volume;
      bottomData.avgPrice = avgPrice;
    } else if (line.startsWith("LQ") || line.startsWith("LTQ")) {
      const [lq, ltt] = line.split("LTT").map((s) => s.trim());
      bottomData.ltq = parseFloat(lq.split(" ").pop());
      // Separate date and time
      const dateTime = ltt.split(" ").pop();
      const date = dateTime.slice(0, 10);
      const time = dateTime.slice(10);
      bottomData.ltt = `${date} ${time}`;
    } else if (line.includes("circuit")) {
      const [lowerCircuit, upperCircuit] = line
        .split(" Upper")
        .map((s) => parseFloat(s.split(" ").pop().trim()));
      bottomData.lowerCircuit = lowerCircuit;
      bottomData.upperCircuit = upperCircuit;
    }
  }

  return {
    orderBook: ob,
    bidTotal,
    askTotal,
    ...bottomData,
  };
}

async function performOCR(imagePath) {
  const worker = await createWorker("eng");
  try {
    const {
      data: { text },
    } = await worker.recognize(imagePath);

    const response = cleanText(text);

    return response;
  } finally {
    await worker.terminate();
  }
}

function createCSV(data) {
  const header =
    "Bid Price,Orders,QTY,Offer,Orders,QTY,Open,High,Low,Prev.Close,Volume,Avg.price,Lower circuit,Upper circuit,LTQ,LTT\n";
  const rows = data.reverse().map((item) => {
    const orderBookRows = item.orderBook.map(
      (ob) =>
        `${ob.bidPrice},${ob.bidOrders},${ob.bidQuantity},${ob.askPrice},${ob.askOrders},${ob.askQuantity},${item.open},${item.high},${item.low},${item.prevClose},${item.volume},${item.avgPrice},${item.lowerCircuit},${item.upperCircuit},${item.ltq},${item.ltt}`,
    );
    return orderBookRows.join("\n");
  });
  return header + rows.join("\n");
}

async function main() {
  try {
    // Delete all files in inputs/* and outputs/*
    await deleteFilesInDirectory("inputs");
    await deleteFilesInDirectory("outputs");
    await extractFrames("resource.mp4", "inputs", 5);
    console.log("Frame extraction complete");
  } catch (error) {
    console.error("Frame extraction failed:", error);
  }
  await cropAllImages();
  const outputDir = "outputs";
  const files = (await fs.readdir(outputDir)).sort(
    (a, b) => parseInt(a.split(".").shift()) - parseInt(b.split(".").shift()),
  );

  const obs = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const filePath = path.join(outputDir, file);
    const response = await performOCR(filePath);

    if (response) {
      obs.push(response);
    }
  }

  // save to json
  await fs.writeFile("output.json", JSON.stringify(obs, null, 2));

  // Create and save CSV
  const csvContent = createCSV(obs);
  await fs.writeFile("output.csv", csvContent);

  console.log("JSON and CSV files have been created.");
}

main();
