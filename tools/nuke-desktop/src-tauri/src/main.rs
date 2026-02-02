// Nuke Desktop App - Rust Backend
// Handles: filesystem scanning, local Ollama processing, cloud sync

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use walkdir::WalkDir;
use regex::Regex;

// File types we scan for
const IMAGE_EXTENSIONS: &[&str] = &["jpg", "jpeg", "png", "gif", "heic", "heif", "webp"];
const DOCUMENT_EXTENSIONS: &[&str] = &["pdf", "doc", "docx", "txt", "rtf"];
const SPREADSHEET_EXTENSIONS: &[&str] = &["csv", "xlsx", "xls", "numbers"];

#[derive(Debug, Serialize, Deserialize)]
pub struct ScanResult {
    pub path: String,
    pub filename: String,
    pub file_type: String,
    pub category: String,
    pub size: u64,
    pub modified: String,
    pub potential_vehicle: Option<VehicleHint>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct VehicleHint {
    pub year: Option<String>,
    pub make: Option<String>,
    pub model: Option<String>,
    pub vin: Option<String>,
    pub confidence: f32,
    pub source: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ScanConfig {
    pub paths: Vec<String>,
    pub include_hidden: bool,
    pub max_depth: Option<usize>,
    pub include_images: bool,
    pub include_documents: bool,
    pub include_spreadsheets: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ScanProgress {
    pub scanned: usize,
    pub found: usize,
    pub current_path: String,
    pub complete: bool,
}

/// Scan directories for vehicle-related files
#[tauri::command]
async fn scan_directories(config: ScanConfig) -> Result<Vec<ScanResult>, String> {
    let mut results = Vec::new();

    for base_path in &config.paths {
        let walker = WalkDir::new(base_path)
            .max_depth(config.max_depth.unwrap_or(10))
            .follow_links(false);

        for entry in walker.into_iter().filter_map(|e| e.ok()) {
            let path = entry.path();

            // Skip hidden files unless explicitly included
            if !config.include_hidden {
                if let Some(name) = path.file_name() {
                    if name.to_string_lossy().starts_with('.') {
                        continue;
                    }
                }
            }

            // Only process files
            if !path.is_file() {
                continue;
            }

            let extension = path
                .extension()
                .map(|e| e.to_string_lossy().to_lowercase())
                .unwrap_or_default();

            // Determine category and whether to include
            let (category, include) = if IMAGE_EXTENSIONS.contains(&extension.as_str()) {
                ("image", config.include_images)
            } else if DOCUMENT_EXTENSIONS.contains(&extension.as_str()) {
                ("document", config.include_documents)
            } else if SPREADSHEET_EXTENSIONS.contains(&extension.as_str()) {
                ("spreadsheet", config.include_spreadsheets)
            } else {
                ("unknown", false)
            };

            if !include {
                continue;
            }

            // Get file metadata
            let metadata = match std::fs::metadata(path) {
                Ok(m) => m,
                Err(_) => continue,
            };

            let modified = metadata
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs().to_string())
                .unwrap_or_default();

            // Try to extract vehicle hints from filename/path
            let potential_vehicle = extract_vehicle_hints(path);

            results.push(ScanResult {
                path: path.to_string_lossy().to_string(),
                filename: path.file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_default(),
                file_type: extension,
                category: category.to_string(),
                size: metadata.len(),
                modified,
                potential_vehicle,
            });
        }
    }

    Ok(results)
}

/// Extract vehicle hints from filename and path
fn extract_vehicle_hints(path: &std::path::Path) -> Option<VehicleHint> {
    let full_path = path.to_string_lossy().to_lowercase();

    // Common vehicle year patterns (1900-2030)
    let year_regex = Regex::new(r"\b(19[0-9]{2}|20[0-3][0-9])\b").ok()?;

    // Common makes
    let makes = vec![
        "chevrolet", "chevy", "ford", "dodge", "gmc", "toyota", "honda",
        "bmw", "mercedes", "porsche", "ferrari", "lamborghini", "audi",
        "volkswagen", "vw", "jeep", "ram", "nissan", "mazda", "subaru",
    ];

    // Common models
    let models = vec![
        "c10", "c20", "k10", "k20", "k5", "blazer", "suburban", "silverado",
        "mustang", "f150", "f-150", "camaro", "corvette", "challenger",
        "charger", "911", "944", "carrera", "civic", "accord", "tacoma",
        "4runner", "wrangler", "bronco",
    ];

    // VIN pattern (17 alphanumeric, no I/O/Q)
    let vin_regex = Regex::new(r"\b[A-HJ-NPR-Z0-9]{17}\b").ok()?;

    let mut hint = VehicleHint {
        year: None,
        make: None,
        model: None,
        vin: None,
        confidence: 0.0,
        source: "filename".to_string(),
    };

    // Extract year
    if let Some(cap) = year_regex.captures(&full_path) {
        hint.year = Some(cap[1].to_string());
        hint.confidence += 0.3;
    }

    // Extract make
    for make in &makes {
        if full_path.contains(make) {
            hint.make = Some(normalize_make(make));
            hint.confidence += 0.3;
            break;
        }
    }

    // Extract model
    for model in &models {
        if full_path.contains(model) {
            hint.model = Some(model.to_uppercase());
            hint.confidence += 0.3;
            break;
        }
    }

    // Extract VIN
    if let Some(cap) = vin_regex.captures(&full_path) {
        hint.vin = Some(cap[0].to_string());
        hint.confidence += 0.5;
    }

    // Only return if we found something
    if hint.confidence > 0.0 {
        Some(hint)
    } else {
        None
    }
}

/// Normalize make names
fn normalize_make(make: &str) -> String {
    match make {
        "chevy" => "Chevrolet".to_string(),
        "vw" => "Volkswagen".to_string(),
        _ => {
            let mut chars = make.chars();
            match chars.next() {
                None => String::new(),
                Some(first) => first.to_uppercase().chain(chars).collect(),
            }
        }
    }
}

/// Parse CSV file for vehicle data
#[tauri::command]
async fn parse_csv(path: String) -> Result<Vec<serde_json::Value>, String> {
    let file = std::fs::File::open(&path)
        .map_err(|e| format!("Failed to open file: {}", e))?;

    let mut reader = csv::ReaderBuilder::new()
        .has_headers(true)
        .flexible(true)
        .from_reader(file);

    let headers = reader.headers()
        .map_err(|e| format!("Failed to read headers: {}", e))?
        .clone();

    let mut results = Vec::new();
    for result in reader.records() {
        let record = result.map_err(|e| format!("Failed to read record: {}", e))?;

        let mut obj = serde_json::Map::new();
        for (i, header) in headers.iter().enumerate() {
            if let Some(value) = record.get(i) {
                obj.insert(header.to_string(), serde_json::Value::String(value.to_string()));
            }
        }
        results.push(serde_json::Value::Object(obj));
    }

    Ok(results)
}

/// Check if Ollama is running locally
#[tauri::command]
async fn check_ollama() -> Result<bool, String> {
    let client = reqwest::Client::new();
    match client.get("http://localhost:11434/api/tags").send().await {
        Ok(response) => Ok(response.status().is_success()),
        Err(_) => Ok(false),
    }
}

/// Process image with local Ollama for vehicle detection
#[tauri::command]
async fn analyze_image_local(image_path: String) -> Result<serde_json::Value, String> {
    // Read image and convert to base64
    let image_data = std::fs::read(&image_path)
        .map_err(|e| format!("Failed to read image: {}", e))?;
    let base64_image = base64::encode(&image_data);

    let client = reqwest::Client::new();

    let request = serde_json::json!({
        "model": "llava",
        "prompt": "Analyze this image. If it shows a vehicle, identify the year, make, model, and any visible modifications. If it's a document (receipt, title, etc.), extract relevant vehicle information. Return JSON with fields: is_vehicle, year, make, model, vin, modifications, document_type, extracted_text.",
        "images": [base64_image],
        "stream": false
    });

    let response = client
        .post("http://localhost:11434/api/generate")
        .json(&request)
        .send()
        .await
        .map_err(|e| format!("Ollama request failed: {}", e))?;

    let result: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    Ok(result)
}

/// Sync files to Nuke cloud
#[tauri::command]
async fn sync_to_cloud(
    files: Vec<ScanResult>,
    api_key: String,
    batch_size: usize,
) -> Result<serde_json::Value, String> {
    let client = reqwest::Client::new();
    let base_url = "https://qkgaybvrernstplzjaam.supabase.co/functions/v1";

    let mut synced = 0;
    let mut failed = 0;
    let mut errors: Vec<String> = Vec::new();

    // Process in batches
    for batch in files.chunks(batch_size) {
        let vehicles: Vec<serde_json::Value> = batch
            .iter()
            .filter_map(|f| {
                f.potential_vehicle.as_ref().map(|v| {
                    serde_json::json!({
                        "year": v.year,
                        "make": v.make,
                        "model": v.model,
                        "vin": v.vin,
                        "description": format!("Imported from {}", f.filename)
                    })
                })
            })
            .collect();

        if vehicles.is_empty() {
            continue;
        }

        let request = serde_json::json!({
            "vehicles": vehicles,
            "options": {
                "skip_duplicates": true,
                "match_by": "vin"
            }
        });

        let response = client
            .post(format!("{}/api-v1-batch", base_url))
            .header("X-API-Key", &api_key)
            .json(&request)
            .send()
            .await;

        match response {
            Ok(resp) => {
                if resp.status().is_success() {
                    synced += vehicles.len();
                } else {
                    failed += vehicles.len();
                    errors.push(format!("Batch failed: {}", resp.status()));
                }
            }
            Err(e) => {
                failed += vehicles.len();
                errors.push(format!("Request error: {}", e));
            }
        }
    }

    Ok(serde_json::json!({
        "synced": synced,
        "failed": failed,
        "errors": errors
    }))
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            scan_directories,
            parse_csv,
            check_ollama,
            analyze_image_local,
            sync_to_cloud,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
