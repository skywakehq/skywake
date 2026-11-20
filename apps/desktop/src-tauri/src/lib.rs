//! Skywake for Mac. It lives in the menu bar too: closing the window only
//! hides it, so mounted disks keep working until you quit.

mod agents;
mod api;
mod auth;
mod drive;
mod keychain;

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use tauri::image::Image;
use tauri::menu::{Menu, MenuBuilder, MenuItem, PredefinedMenuItem, SubmenuBuilder};
use tauri::{AppHandle, Emitter, Manager, RunEvent, State, WindowEvent};
use tauri_plugin_opener::OpenerExt;

use auth::{Account, Profile};
use drive::{Drives, Status};

/// The sign-in waiting for the browser, so it can be cancelled.
#[derive(Default)]
struct Pending(Mutex<Option<tokio::task::AbortHandle>>);

/// Disk names from the last listing, for the menu bar's Mount menu.
#[derive(Default)]
struct Known(Mutex<Vec<String>>);

/// A mount to bring back when the app starts again. Not a secret.
#[derive(Clone, PartialEq, Serialize, Deserialize)]
struct Remembered {
    disk: String,
    branch: String,
}

fn remembered_file(app: &AppHandle) -> Option<PathBuf> {
    Some(app.path().app_config_dir().ok()?.join("mounts.json"))
}

fn remembered(app: &AppHandle) -> Vec<Remembered> {
    remembered_file(app)
        .and_then(|file| std::fs::read_to_string(file).ok())
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

fn remember(app: &AppHandle, change: impl FnOnce(&mut Vec<Remembered>)) {
    let mut all = remembered(app);
    change(&mut all);
    if let Some(file) = remembered_file(app) {
        let _ = std::fs::create_dir_all(file.parent().unwrap_or(&file));
        let _ = std::fs::write(file, serde_json::to_string(&all).unwrap_or_default());
    }
}

fn device() -> String {
    let name = gethostname::gethostname().to_string_lossy().into_owned();
    name.trim_end_matches(".local").to_string()
}

fn home() -> Result<PathBuf, String> {
    std::env::var("HOME")
        .map(PathBuf::from)
        .map_err(|_| "No home folder.".to_string())
}

#[tauri::command]
async fn profile(account: State<'_, Arc<Account>>) -> Result<Option<Profile>, String> {
    Ok(account.profile().await)
}

#[tauri::command]
async fn sign_in(
    org: Option<String>,
    app: AppHandle,
    account: State<'_, Arc<Account>>,
    pending: State<'_, Pending>,
) -> Result<Profile, String> {
    let account = account.inner().clone();
    let opener = app.clone();
    let task = tokio::spawn(async move {
        let open = |url: &str| {
            opener
                .opener()
                .open_url(url, None::<&str>)
                .map_err(|error| error.to_string())
        };
        account.sign_in(open, &device(), org.as_deref()).await
    });
    *pending.0.lock().unwrap() = Some(task.abort_handle());
    let profile = task.await.unwrap_or_else(|_| Err("cancelled".into()))?;
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_focus();
    }
    restore(app);
    Ok(profile)
}

#[tauri::command]
fn cancel_sign_in(pending: State<'_, Pending>) {
    if let Some(task) = pending.0.lock().unwrap().take() {
        task.abort();
    }
}

#[tauri::command]
async fn sign_out(app: AppHandle) -> Result<(), String> {
    sign_out_now(&app).await
}

async fn sign_out_now(app: &AppHandle) -> Result<(), String> {
    let failed = app.state::<Drives>().unmount_all().await;
    if !failed.is_empty() {
        return Err(format!(
            "Signed in still: some changes could not be saved. {}",
            failed.join(" ")
        ));
    }
    app.state::<Arc<Account>>().sign_out().await;
    // The next person to sign in starts with nothing mounted.
    remember(app, Vec::clear);
    app.state::<Known>().0.lock().unwrap().clear();
    let _ = app.emit("signed-out", ());
    changed(app).await;
    Ok(())
}

#[tauri::command]
async fn environments(account: State<'_, Arc<Account>>) -> Result<Vec<api::Environment>, String> {
    api::environments(&account).await
}

#[tauri::command]
async fn disks(
    app: AppHandle,
    account: State<'_, Arc<Account>>,
    known: State<'_, Known>,
) -> Result<Vec<api::Disk>, String> {
    let disks = api::disks(&account).await?;
    *known.0.lock().unwrap() = disks.iter().map(|disk| disk.name.clone()).collect();
    tray_menu(&app).await;
    Ok(disks)
}

#[tauri::command]
async fn branches(
    disk: String,
    account: State<'_, Arc<Account>>,
) -> Result<Vec<api::Branch>, String> {
    api::branches(&account, &disk).await
}

#[tauri::command]
async fn commits(
    disk: String,
    branch: String,
    account: State<'_, Arc<Account>>,
) -> Result<Vec<api::Commit>, String> {
    api::commits(&account, &disk, &branch).await
}

#[tauri::command]
async fn drives(drives: State<'_, Drives>) -> Result<Vec<Status>, String> {
    Ok(drives.statuses().await)
}

#[tauri::command]
async fn mount(disk: String, branch: String, app: AppHandle) -> Result<PathBuf, String> {
    mount_now(&app, &disk, &branch).await
}

async fn mount_now(app: &AppHandle, disk: &str, branch: &str) -> Result<PathBuf, String> {
    let account = app.state::<Arc<Account>>().inner().clone();
    let notify = app.clone();
    let on_change: Arc<dyn Fn() + Send + Sync> = Arc::new(move || {
        let app = notify.clone();
        tauri::async_runtime::spawn(async move { changed(&app).await });
    });
    let dir = app
        .state::<Drives>()
        .mount(account, disk, branch, on_change)
        .await?;
    let entry = Remembered {
        disk: disk.into(),
        branch: branch.into(),
    };
    remember(app, |all| {
        if !all.contains(&entry) {
            all.push(entry);
        }
    });
    changed(app).await;
    Ok(dir)
}

#[tauri::command]
async fn unmount(disk: String, branch: String, app: AppHandle) -> Result<(), String> {
    unmount_now(&app, &disk, &branch).await
}

async fn unmount_now(app: &AppHandle, disk: &str, branch: &str) -> Result<(), String> {
    let result = app.state::<Drives>().unmount(disk, branch).await;
    if result.is_ok() {
        remember(app, |all| {
            all.retain(|each| each.disk != disk || each.branch != branch)
        });
    }
    changed(app).await;
    result
}

/// Mounts again what was mounted when the app last quit.
fn restore(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        if app.state::<Arc<Account>>().profile().await.is_none() {
            return;
        }
        for each in remembered(&app) {
            if let Err(error) = mount_now(&app, &each.disk, &each.branch).await {
                eprintln!("skywake: could not mount {} again: {error}", each.disk);
            }
        }
    });
}

/// Tells the window, and the menu bar, how the drives are doing.
async fn changed(app: &AppHandle) {
    let statuses = app.state::<Drives>().statuses().await;
    let _ = app.emit("drives", &statuses);
    tray_menu(app).await;
}

#[tauri::command]
fn reveal(path: String, app: AppHandle) -> Result<(), String> {
    app.opener()
        .open_path(path, None::<&str>)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn open_terminal(path: String) -> Result<(), String> {
    std::process::Command::new("/usr/bin/open")
        .args(["-a", "Terminal"])
        .arg(path)
        .spawn()
        .map(|_| ())
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn open_console(
    disk: String,
    app: AppHandle,
    account: State<'_, Arc<Account>>,
) -> Result<(), String> {
    // No disk: the console's home, to make one.
    let url = match disk.split_once('/') {
        _ if disk.is_empty() => account.console.clone(),
        Some((env, name)) => format!(
            "{}/e/{}/d/{}",
            account.console,
            auth::encode(env),
            auth::encode(name)
        ),
        None => format!("{}/e/{}", account.console, auth::encode(&disk)),
    };
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn mcp_config(disk: String, branch: String, account: State<'_, Arc<Account>>) -> String {
    let name = agents::server_name(&disk, &branch);
    let entry =
        serde_json::json!({ "mcpServers": { name: agents::server(&account.api, &disk, &branch) } });
    serde_json::to_string_pretty(&entry).unwrap_or_default()
}

#[tauri::command]
fn agent_plan(
    agent: String,
    disk: String,
    branch: String,
    account: State<'_, Arc<Account>>,
) -> Result<agents::Plan, String> {
    agents::plan(
        &home()?,
        agents::Agent::parse(&agent)?,
        &account.api,
        &disk,
        &branch,
    )
}

#[tauri::command]
fn agent_add(
    agent: String,
    disk: String,
    branch: String,
    account: State<'_, Arc<Account>>,
) -> Result<PathBuf, String> {
    agents::add(
        &home()?,
        agents::Agent::parse(&agent)?,
        &account.api,
        &disk,
        &branch,
    )
}

fn show(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// The menu bar menu: what is mounted, with a way to unmount each, and the
/// disks to mount.
async fn tray_menu(app: &AppHandle) {
    let statuses = app.state::<Drives>().statuses().await;
    let known = app.state::<Known>().0.lock().unwrap().clone();
    let signed_in = app.state::<Arc<Account>>().profile().await.is_some();
    if let Ok(menu) = build_menu(app, &statuses, &known, signed_in)
        && let Some(tray) = app.tray_by_id("main")
    {
        let _ = tray.set_menu(Some(menu));
    }
}

fn build_menu(
    app: &AppHandle,
    statuses: &[Status],
    known: &[String],
    signed_in: bool,
) -> tauri::Result<Menu<tauri::Wry>> {
    let mut menu = MenuBuilder::new(app);
    if signed_in {
        if statuses.is_empty() {
            menu = menu.item(&MenuItem::with_id(
                app,
                "none",
                "Nothing mounted",
                false,
                None::<&str>,
            )?);
        }
        for status in statuses {
            let label = match status.state {
                "error" => format!(
                    "{}  ·  needs attention",
                    drive::id(&status.disk, &status.branch)
                ),
                "syncing" => format!("{}  ·  syncing", drive::id(&status.disk, &status.branch)),
                _ => drive::id(&status.disk, &status.branch),
            };
            let key = drive::id(&status.disk, &status.branch);
            let submenu = SubmenuBuilder::new(app, label)
                .text(format!("reveal:{key}"), "Show in Finder")
                .text(format!("unmount:{key}"), "Unmount")
                .build()?;
            menu = menu.item(&submenu);
        }
        let mounted: Vec<String> = statuses
            .iter()
            .map(|s| drive::id(&s.disk, &s.branch))
            .collect();
        let more: Vec<&String> = known
            .iter()
            .filter(|disk| !mounted.contains(&drive::id(disk, "main")))
            .collect();
        if !more.is_empty() {
            let mut mount = SubmenuBuilder::new(app, "Mount");
            for disk in more {
                mount = mount.text(format!("mount:{disk}"), disk.as_str());
            }
            menu = menu.separator().item(&mount.build()?);
        }
        menu = menu.separator();
    }
    menu = menu
        .item(&MenuItem::with_id(
            app,
            "open",
            "Open Skywake",
            true,
            None::<&str>,
        )?)
        .item(&PredefinedMenuItem::separator(app)?)
        .item(&MenuItem::with_id(
            app,
            "quit",
            "Quit Skywake",
            true,
            Some("CmdOrCtrl+Q"),
        )?);
    menu.build()
}

fn on_menu(app: &AppHandle, id: &str) {
    let app = app.clone();
    let id = id.to_string();
    if id == "open" {
        return show(&app);
    }
    if id == "quit" {
        return app.exit(0);
    }
    tauri::async_runtime::spawn(async move {
        let result = if let Some(disk) = id.strip_prefix("mount:") {
            mount_now(&app, disk, "main").await.map(|dir| {
                let _ = app.opener().open_path(dir.to_string_lossy(), None::<&str>);
            })
        } else if let Some(key) = id.strip_prefix("unmount:") {
            let (disk, branch) = key.rsplit_once('@').unwrap_or((key, "main"));
            unmount_now(&app, disk, branch).await
        } else if let Some(key) = id.strip_prefix("reveal:") {
            let statuses = app.state::<Drives>().statuses().await;
            match statuses
                .iter()
                .find(|s| drive::id(&s.disk, &s.branch) == key)
            {
                Some(status) => app
                    .opener()
                    .open_path(status.path.to_string_lossy(), None::<&str>)
                    .map_err(|error| error.to_string()),
                None => Ok(()),
            }
        } else {
            Ok(())
        };
        if let Err(error) = result {
            let _ = app.emit("menu-error", error);
            show(&app);
        }
    });
}

fn tray(app: &tauri::App) -> tauri::Result<()> {
    let menu = build_menu(app.handle(), &[], &[], false)?;
    tauri::tray::TrayIconBuilder::with_id("main")
        .icon(Image::from_bytes(include_bytes!("../icons/tray.png"))?)
        .icon_as_template(true)
        .tooltip("Skywake")
        .menu(&menu)
        .on_menu_event(|app, event| on_menu(app, event.id().as_ref()))
        .build(app)?;
    Ok(())
}

fn setting(name: &str, default: &str) -> String {
    std::env::var(name).unwrap_or_else(|_| default.into())
}

pub fn run() {
    let account = Arc::new(Account::new(
        setting("SKYWAKE_API", "http://localhost:8080"),
        setting("SKYWAKE_CONSOLE", "http://localhost:3100"),
    ));
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(account)
        .manage(Pending::default())
        .manage(Known::default())
        .manage(Drives::default())
        .invoke_handler(tauri::generate_handler![
            profile,
            sign_in,
            cancel_sign_in,
            sign_out,
            environments,
            disks,
            branches,
            commits,
            drives,
            mount,
            unmount,
            reveal,
            open_terminal,
            open_console,
            mcp_config,
            agent_plan,
            agent_add
        ])
        .setup(|app| {
            tray(app)?;
            restore(app.handle().clone());
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .build(tauri::generate_context!())
        .expect("Skywake could not start")
        .run(|app, event| match event {
            // Clicking the Dock icon brings the window back.
            RunEvent::Reopen { .. } => show(app),
            RunEvent::Exit => {
                let drives = app.state::<Drives>();
                let _ = tauri::async_runtime::block_on(drives.unmount_all());
            }
            _ => {}
        });
}
