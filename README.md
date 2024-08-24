# OCR on orderbook video

## How the code works

1. The code uses ffmpeg to extract frames from the video
2. The frames are then cropped (to focus on the important text) and saved in the `outputs` directory
3. The data is extracted from each image using tesseract OCR engine
4. The extracted data is saved to json and csv files

## Running

1. Ensure ffmpeg is installed on your system // ffmpeg is used to extract frames from the input video
2. Run `pnpm install` to install dependencies
3. Run `pnpm start` to start the script

## Note

The script assumes that the input video is in the same directory as the script file. If the input video is in a different directory, you need to modify the `extractFrames` function in `index.js` to provide the correct path to the input video.
