use serde::Serialize;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};

const STATE_EVENT: &str = "presentation-state";

#[derive(Clone, Serialize)]
struct PresentationSnapshot {
    current_page: usize,
    total_pages: usize,
}

struct PresentationModel {
    current_page: usize,
    total_pages: usize,
}

impl PresentationModel {
    fn snapshot(&self) -> PresentationSnapshot {
        PresentationSnapshot {
            current_page: self.current_page + 1,
            total_pages: self.total_pages,
        }
    }

    fn next_page(&mut self) -> PresentationSnapshot {
        if self.current_page + 1 < self.total_pages {
            self.current_page += 1;
        }

        self.snapshot()
    }

    fn previous_page(&mut self) -> PresentationSnapshot {
        if self.current_page > 0 {
            self.current_page -= 1;
        }

        self.snapshot()
    }
}

struct AppState {
    presentation: Mutex<PresentationModel>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            presentation: Mutex::new(PresentationModel {
                current_page: 0,
                total_pages: 8,
            }),
        }
    }
}

#[tauri::command]
fn get_presentation_state(state: State<'_, AppState>) -> Result<PresentationSnapshot, String> {
    let presentation = state
        .presentation
        .lock()
        .map_err(|_| "presentation state lock poisoned".to_string())?;

    Ok(presentation.snapshot())
}

#[tauri::command]
fn next_page(
    app_handle: AppHandle,
    state: State<'_, AppState>,
) -> Result<PresentationSnapshot, String> {
    let snapshot = {
        let mut presentation = state
            .presentation
            .lock()
            .map_err(|_| "presentation state lock poisoned".to_string())?;
        presentation.next_page()
    };

    app_handle
        .emit(STATE_EVENT, snapshot.clone())
        .map_err(|error| error.to_string())?;

    Ok(snapshot)
}

#[tauri::command]
fn previous_page(
    app_handle: AppHandle,
    state: State<'_, AppState>,
) -> Result<PresentationSnapshot, String> {
    let snapshot = {
        let mut presentation = state
            .presentation
            .lock()
            .map_err(|_| "presentation state lock poisoned".to_string())?;
        presentation.previous_page()
    };

    app_handle
        .emit(STATE_EVENT, snapshot.clone())
        .map_err(|error| error.to_string())?;

    Ok(snapshot)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            get_presentation_state,
            next_page,
            previous_page
        ])
        .setup(|app| {
            WebviewWindowBuilder::new(
                app,
                "audience",
                WebviewUrl::App("index.html?role=audience".into()),
            )
            .title("ppmc audience")
            .inner_size(1024.0, 768.0)
            .build()?;

            if let Some(window) = app.get_webview_window("presenter") {
                window.set_title("ppmc presenter")?;
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
