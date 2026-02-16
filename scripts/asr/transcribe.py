#!/usr/bin/env python3
"""
Tidemark ASR Transcription Script
Supports Whisper and Qwen3-ASR engines
Communicates progress via JSON line protocol on stdout
"""

import sys
import json
import argparse
from pathlib import Path
from typing import Optional, Dict, Any
import time


def send_progress(processed: float, total: float):
    """Send progress update to Rust backend"""
    progress = {
        "type": "progress",
        "processed": processed,
        "total": total
    }
    print(json.dumps(progress), flush=True)


def send_complete(output_path: str):
    """Send completion notification"""
    complete = {
        "type": "complete",
        "output_path": output_path
    }
    print(json.dumps(complete), flush=True)


def send_error(message: str):
    """Send error notification"""
    error = {
        "type": "error",
        "message": message
    }
    print(json.dumps(error), flush=True)


def transcribe_with_whisper(config: Dict[str, Any]) -> str:
    """
    Transcribe audio using OpenAI Whisper
    Returns: output file path
    """
    try:
        import torch
        import whisper
        from whisper.utils import get_writer
    except ImportError as e:
        send_error(f"Missing dependency: {str(e)}. Please install whisper: pip install openai-whisper")
        sys.exit(1)

    input_file = config["input_file"]
    model_name = config["model"]
    language = None if config["language"] == "auto" else config["language"]
    output_format = config["output_format"]
    hardware_mode = config["hardware_mode"]

    # Determine device
    device = "cpu"
    if hardware_mode == "gpu" or hardware_mode == "auto":
        if torch.cuda.is_available():
            device = "cuda"
        elif torch.backends.mps.is_available():
            device = "mps"
        elif hardware_mode == "gpu":
            # GPU requested but not available - auto downgrade
            send_error("GPU 不可用，已自動切換至 CPU 模式")
            device = "cpu"

    # Load model
    try:
        model = whisper.load_model(model_name, device=device)
    except Exception as e:
        send_error(f"無法載入模型 {model_name}: {str(e)}")
        sys.exit(1)

    # Transcribe with progress callback
    try:
        # Get total duration using ffprobe
        import subprocess
        duration_result = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1", input_file],
            capture_output=True, text=True
        )
        total_duration = float(duration_result.stdout.strip())

        # Transcribe
        result = model.transcribe(
            input_file,
            language=language,
            verbose=False,
            task="transcribe"
        )

        # Progress updates (simulate progress during transcription)
        # In real implementation, we'd hook into Whisper's internal progress
        send_progress(total_duration * 0.5, total_duration)

        # Prepare output
        input_path = Path(input_file)
        output_dir = config.get("output_dir", input_path.parent)
        output_dir = Path(output_dir)
        output_dir.mkdir(parents=True, exist_ok=True)

        base_name = input_path.stem
        output_files = []

        # Generate SRT
        if output_format in ["srt", "both"]:
            srt_path = output_dir / f"{base_name}.srt"
            writer = get_writer("srt", str(output_dir))
            writer(result, str(input_path.stem))
            output_files.append(str(srt_path))

        # Generate TXT
        if output_format in ["txt", "both"]:
            txt_path = output_dir / f"{base_name}.txt"
            with open(txt_path, "w", encoding="utf-8") as f:
                f.write(result["text"])
            output_files.append(str(txt_path))

        send_progress(total_duration, total_duration)

        # Return first output file (or both if needed)
        return output_files[0] if output_files else ""

    except MemoryError:
        send_error("記憶體不足，請嘗試較小的模型")
        sys.exit(1)
    except Exception as e:
        send_error(f"轉錄失敗: {str(e)}")
        sys.exit(1)


def transcribe_with_qwen(config: Dict[str, Any]) -> str:
    """
    Transcribe audio using Qwen3-ASR
    Returns: output file path
    """
    try:
        from funasr import AutoModel
        import torch
    except ImportError as e:
        send_error(f"Missing dependency: {str(e)}. Please install FunASR")
        sys.exit(1)

    input_file = config["input_file"]
    model_name = config["model"]
    language = config["language"]
    output_format = config["output_format"]
    enable_punctuation = config.get("enable_punctuation", True)
    traditional_chinese = config.get("traditional_chinese", False)

    # Determine device
    device = "cpu"
    hardware_mode = config.get("hardware_mode", "auto")
    if hardware_mode == "gpu" or hardware_mode == "auto":
        if torch.cuda.is_available():
            device = "cuda:0"
        elif hardware_mode == "gpu":
            send_error("GPU 不可用，已自動切換至 CPU 模式")

    # Load model
    try:
        # Map model ID to FunASR model path
        model_map = {
            "qwen3-asr-base": "iic/Qwen2Audio-7B-Instruct",
            "qwen3-asr-large": "iic/Qwen2Audio-7B-Instruct"
        }
        model_path = model_map.get(model_name, model_name)

        model = AutoModel(
            model=model_path,
            device=device,
            disable_pbar=False,
            disable_update=True
        )
    except Exception as e:
        send_error(f"無法載入模型 {model_name}: {str(e)}")
        sys.exit(1)

    try:
        # Get total duration
        import subprocess
        duration_result = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1", input_file],
            capture_output=True, text=True
        )
        total_duration = float(duration_result.stdout.strip())

        # Transcribe
        result = model.generate(
            input=input_file,
            batch_size_s=300,
        )

        send_progress(total_duration * 0.8, total_duration)

        # Extract text from result
        if isinstance(result, list) and len(result) > 0:
            text = result[0].get("text", "")
        else:
            text = str(result)

        # Convert to traditional Chinese if requested
        if traditional_chinese and language == "zh":
            try:
                from opencc import OpenCC
                cc = OpenCC('s2t')
                text = cc.convert(text)
            except ImportError:
                pass  # Skip conversion if OpenCC not available

        # Prepare output
        input_path = Path(input_file)
        output_dir = config.get("output_dir", input_path.parent)
        output_dir = Path(output_dir)
        output_dir.mkdir(parents=True, exist_ok=True)

        base_name = input_path.stem
        output_files = []

        # For Qwen, we primarily generate text
        # SRT generation would require timestamps which Qwen doesn't provide by default
        if output_format in ["txt", "both"]:
            txt_path = output_dir / f"{base_name}.txt"
            with open(txt_path, "w", encoding="utf-8") as f:
                f.write(text)
            output_files.append(str(txt_path))

        if output_format in ["srt", "both"]:
            # Generate simple SRT with single timestamp
            srt_path = output_dir / f"{base_name}.srt"
            with open(srt_path, "w", encoding="utf-8") as f:
                f.write("1\n")
                f.write("00:00:00,000 --> 99:59:59,999\n")
                f.write(text + "\n")
            output_files.append(str(srt_path))

        send_progress(total_duration, total_duration)

        return output_files[0] if output_files else ""

    except MemoryError:
        send_error("記憶體不足，請嘗試較小的模型")
        sys.exit(1)
    except Exception as e:
        send_error(f"轉錄失敗: {str(e)}")
        sys.exit(1)


def main():
    parser = argparse.ArgumentParser(description="ASR Transcription Script")
    parser.add_argument("--config", type=str, help="JSON configuration string")
    parser.add_argument("--config-file", type=str, help="Path to JSON configuration file")

    args = parser.parse_args()

    # Load configuration
    config = None
    if args.config:
        config = json.loads(args.config)
    elif args.config_file:
        with open(args.config_file, "r") as f:
            config = json.load(f)
    else:
        # Read from stdin
        config = json.load(sys.stdin)

    if not config:
        send_error("No configuration provided")
        sys.exit(1)

    engine = config.get("engine", "whisper")

    # Route to appropriate engine
    if engine == "whisper":
        output_path = transcribe_with_whisper(config)
    elif engine == "qwen":
        output_path = transcribe_with_qwen(config)
    else:
        send_error(f"Unknown engine: {engine}")
        sys.exit(1)

    # Send completion
    send_complete(output_path)


if __name__ == "__main__":
    main()
