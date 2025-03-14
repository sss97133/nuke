#!/usr/bin/env python3
from PIL import Image, ImageDraw, ImageFont
import os

# Create a simple blue square with "N" for Nuke
def create_icon(size):
    # Create a blue background
    img = Image.new('RGB', (size, size), color=(62, 99, 221))
    draw = ImageDraw.Draw(img)
    
    # Try to use a system font
    try:
        # Attempt to use a system font
        font_size = size // 2
        font = ImageFont.truetype("Arial", font_size)
    except:
        # If that fails, use the default font
        font = ImageFont.load_default()
    
    # Add the "N" text in white at the center
    text = "N"
    text_width, text_height = draw.textsize(text, font=font) if hasattr(draw, 'textsize') else (size//2, size//2)
    position = ((size-text_width)//2, (size-text_height)//2)
    draw.text(position, text, fill=(255, 255, 255), font=font)
    
    return img

# Create icons of different sizes
sizes = [16, 48, 128]
for size in sizes:
    icon = create_icon(size)
    icon.save(f"icon{size}.png")
    print(f"Created icon{size}.png")
