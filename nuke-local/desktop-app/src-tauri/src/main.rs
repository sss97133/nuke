// Nuke Intake - Local document processing with AI
//
// Architecture:
// 1. User selects folder(s) to scan
// 2. Rust backend walks directories, finds images/PDFs
// 3. Each file sent to local Ollama for analysis
// 4. Results shown in wizard UI for approval
// 5. Approved data synced to Supabase

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::State;
use tokio::sync::Mutex;

// App state
struct AppState {
    ollama_url: Mutex<String>,
    supabase_url: Mutex<Option<String>>,
    supabase_key: Mutex<Option<String>>,
}

// Document found during scan
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScannedDocument {
    pub path: String,
    pub filename: String,
    pub file_type: String, // image, pdf
    pub size_bytes: u64,
    pub modified: String,
}

// Extraction result from Ollama
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtractionResult {
    pub path: String,
    pub document_type: String, // title, registration, invoice, unknown
    pub confidence: f32,
    pub extracted: ExtractedData,
    pub raw_response: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ExtractedData {
    pub vin: Option<String>,
    pub year: Option<i32>,
    pub make: Option<String>,
    pub model: Option<String>,
    pub owner_name: Option<String>,
    pub mileage: Option<i32>,
    pub price: Option<f64>,
    pub date: Option<String>,
}

// Scan a directory for documents
#[tauri::command]
async fn scan_directory(path: String) -> Result<Vec<ScannedDocument>, String> {
    use walkdir::WalkDir;

    let mut documents = Vec::new();
    let valid_extensions = ["jpg", "jpeg", "png", "gif", "webp", "pdf", "heic"];

    for entry in WalkDir::new(&path)
        .follow_links(true)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        let path = entry.path();

        if !path.is_file() {
            continue;
        }

        let extension = path
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_lowercase())
            .unwrap_or_default();

        if !valid_extensions.contains(&extension.as_str()) {
            continue;
        }

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

        let file_type = if extension == "pdf" {
            "pdf".to_string()
        } else {
            "image".to_string()
        };

        documents.push(ScannedDocument {
            path: path.to_string_lossy().to_string(),
            filename: path.file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default(),
            file_type,
            size_bytes: metadata.len(),
            modified,
        });
    }

    // Sort by modified date, newest first
    documents.sort_by(|a, b| b.modified.cmp(&a.modified));

    Ok(documents)
}

// Check if Ollama is running
#[tauri::command]
async fn check_ollama(state: State<'_, AppState>) -> Result<bool, String> {
    let url = state.ollama_url.lock().await;
    let client = reqwest::Client::new();

    match client.get(format!("{}/api/tags", *url)).send().await {
        Ok(resp) => Ok(resp.status().is_success()),
        Err(_) => Ok(false),
    }
}

// List available Ollama models
#[tauri::command]
async fn list_ollama_models(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let url = state.ollama_url.lock().await;
    let client = reqwest::Client::new();

    let resp = client
        .get(format!("{}/api/tags", *url))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    #[derive(Deserialize)]
    struct TagsResponse {
        models: Vec<ModelInfo>,
    }

    #[derive(Deserialize)]
    struct ModelInfo {
        name: String,
    }

    let tags: TagsResponse = resp.json().await.map_err(|e| e.to_string())?;
    Ok(tags.models.into_iter().map(|m| m.name).collect())
}

// Process a document with Ollama vision
#[tauri::command]
async fn process_document(
    state: State<'_, AppState>,
    path: String,
    model: String,
) -> Result<ExtractionResult, String> {
    let url = state.ollama_url.lock().await;
    let client = reqwest::Client::new();

    // Read and encode image
    let image_data = std::fs::read(&path).map_err(|e| e.to_string())?;
    let base64_image = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &image_data);

    // Build prompt for vehicle document extraction
    let prompt = r#"Analyze this vehicle document image. Extract any of the following information if visible:

- Document type (title, registration, invoice, receipt, photo, other)
- VIN (Vehicle Identification Number - 17 characters)
- Year
- Make (manufacturer)
- Model
- Owner name
- Mileage
- Price or sale amount
- Date on document

Return ONLY valid JSON in this exact format:
{
  "document_type": "title",
  "confidence": 0.95,
  "vin": "1G1YY22G965109876",
  "year": 2006,
  "make": "Chevrolet",
  "model": "Corvette",
  "owner_name": "John Smith",
  "mileage": 45000,
  "price": 35000.00,
  "date": "2024-01-15"
}

Use null for any fields not found. Be conservative with confidence - only use high values if text is clearly readable."#;

    #[derive(Serialize)]
    struct OllamaRequest {
        model: String,
        prompt: String,
        images: Vec<String>,
        stream: bool,
    }

    let request = OllamaRequest {
        model: model.clone(),
        prompt: prompt.to_string(),
        images: vec![base64_image],
        stream: false,
    };

    let resp = client
        .post(format!("{}/api/generate", *url))
        .json(&request)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    #[derive(Deserialize)]
    struct OllamaResponse {
        response: String,
    }

    let ollama_resp: OllamaResponse = resp.json().await.map_err(|e| e.to_string())?;

    // Parse JSON from response
    let raw = &ollama_resp.response;

    // Try to extract JSON from the response
    let json_start = raw.find('{').unwrap_or(0);
    let json_end = raw.rfind('}').map(|i| i + 1).unwrap_or(raw.len());
    let json_str = &raw[json_start..json_end];

    #[derive(Deserialize, Default)]
    struct ParsedResponse {
        document_type: Option<String>,
        confidence: Option<f32>,
        vin: Option<String>,
        year: Option<i32>,
        make: Option<String>,
        model: Option<String>,
        owner_name: Option<String>,
        mileage: Option<i32>,
        price: Option<f64>,
        date: Option<String>,
    }

    let parsed: ParsedResponse = serde_json::from_str(json_str).unwrap_or_default();

    Ok(ExtractionResult {
        path,
        document_type: parsed.document_type.unwrap_or_else(|| "unknown".to_string()),
        confidence: parsed.confidence.unwrap_or(0.3),
        extracted: ExtractedData {
            vin: parsed.vin,
            year: parsed.year,
            make: parsed.make,
            model: parsed.model,
            owner_name: parsed.owner_name,
            mileage: parsed.mileage,
            price: parsed.price,
            date: parsed.date,
        },
        raw_response: ollama_resp.response,
    })
}

// Configure Supabase connection
#[tauri::command]
async fn configure_supabase(
    state: State<'_, AppState>,
    url: String,
    key: String,
) -> Result<(), String> {
    *state.supabase_url.lock().await = Some(url);
    *state.supabase_key.lock().await = Some(key);
    Ok(())
}

// Sync approved extractions to Supabase
#[tauri::command]
async fn sync_to_supabase(
    state: State<'_, AppState>,
    extractions: Vec<ExtractionResult>,
) -> Result<usize, String> {
    let url = state.supabase_url.lock().await;
    let key = state.supabase_key.lock().await;

    let base_url = url.as_ref().ok_or("Supabase not configured")?;
    let api_key = key.as_ref().ok_or("Supabase not configured")?;

    let client = reqwest::Client::new();
    let mut synced = 0;

    for extraction in extractions {
        if extraction.extracted.vin.is_none() {
            continue; // Skip items without VIN
        }

        #[derive(Serialize)]
        struct ImportQueueItem {
            url: String,
            source: String,
            priority: i32,
            metadata: serde_json::Value,
        }

        let item = ImportQueueItem {
            url: format!("file://{}", extraction.path),
            source: "desktop_intake".to_string(),
            priority: 5,
            metadata: serde_json::json!({
                "document_type": extraction.document_type,
                "confidence": extraction.confidence,
                "extracted": extraction.extracted,
            }),
        };

        let resp = client
            .post(format!("{}/rest/v1/import_queue", base_url))
            .header("apikey", api_key.as_str())
            .header("Authorization", format!("Bearer {}", api_key))
            .header("Content-Type", "application/json")
            .header("Prefer", "return=minimal")
            .json(&item)
            .send()
            .await;

        if resp.is_ok() {
            synced += 1;
        }
    }

    Ok(synced)
}

fn main() {
    tauri::Builder::default()
        .manage(AppState {
            ollama_url: Mutex::new("http://localhost:11434".to_string()),
            supabase_url: Mutex::new(None),
            supabase_key: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            scan_directory,
            check_ollama,
            list_ollama_models,
            process_document,
            configure_supabase,
            sync_to_supabase,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
