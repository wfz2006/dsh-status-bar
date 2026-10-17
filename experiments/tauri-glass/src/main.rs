#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use tauri::{WebviewUrl, WebviewWindowBuilder};
use tauri::utils::config::WindowEffectsConfig;
use tauri::window::{Color, Effect};
mod native;

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let material = std::env::var("GLASS_COMPARE_MATERIAL").unwrap_or("clear".into());
            let mode = std::env::var("GLASS_COMPARE_MODE").unwrap_or("peek".into());
            let (width,height) = match mode.as_str() { "capsule" => (300.,56.), "expanded" => (340.,340.), "approval" => (340.,320.), _ => (340.,168.) };
            let mut builder = WebviewWindowBuilder::new(app, "compare", WebviewUrl::App("index.html".into()))
                .title(format!("DSH Glass Compare · {material}"))
                .inner_size(width,height).position(200.,150.)
                .resizable(false)
                .decorations(false).shadow(false).transparent(true)
                .background_color(Color(0,0,0,0)).always_on_top(true)
                .initialization_script(format!("window.COMPARE_MODE={};",serde_json::to_string(&mode)?));
            if material == "acrylic" {
                builder = builder.effects(WindowEffectsConfig { effects:vec![Effect::Acrylic], color:Some(Color(0,0,0,0)), ..Default::default() });
            }
            let window = builder.build()?;
            let hwnd = window.hwnd()?;
            if material == "native" || material == "native-zero" {
                let scale=window.scale_factor()? as f32;
                if let Err(error)=native::attach(hwnd,width as f32*scale,height as f32*scale,26.*scale,material=="native") {
                    std::fs::write("native-error.txt",format!("{error:?}"))?;
                    return Err(error.into());
                }
            }
            std::fs::write("window.json", serde_json::to_string_pretty(&serde_json::json!({"handle":hwnd.0 as usize,"material":material,"mode":mode,"scale":window.scale_factor()?}))?)?;
            window.set_focus()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("native comparison failed");
}
