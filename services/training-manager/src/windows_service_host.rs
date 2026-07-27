use std::{
    ffi::OsString,
    sync::{Arc, Mutex},
    time::Duration,
};

use tokio::sync::oneshot;
use windows_service::{
    define_windows_service,
    service::{
        ServiceControl, ServiceControlAccept, ServiceExitCode, ServiceState, ServiceStatus,
        ServiceType,
    },
    service_control_handler::{self, ServiceControlHandlerResult},
    service_dispatcher,
};

const SERVICE_NAME: &str = "TomeTrainingManager";

define_windows_service!(ffi_service_main, service_main);

pub fn start() -> windows_service::Result<()> {
    service_dispatcher::start(SERVICE_NAME, ffi_service_main)
}

fn service_main(_arguments: Vec<OsString>) {
    if let Err(error) = run() {
        eprintln!("Tome Training Manager service failed: {error}");
    }
}

fn run() -> windows_service::Result<()> {
    let (shutdown_sender, shutdown_receiver) = oneshot::channel::<()>();
    let shutdown_sender = Arc::new(Mutex::new(Some(shutdown_sender)));
    let sender_for_handler = shutdown_sender.clone();
    let status_handle = service_control_handler::register(
        SERVICE_NAME,
        move |control| -> ServiceControlHandlerResult {
            match control {
                ServiceControl::Stop => {
                    if let Ok(mut sender) = sender_for_handler.lock() {
                        if let Some(sender) = sender.take() {
                            let _ = sender.send(());
                        }
                    }
                    ServiceControlHandlerResult::NoError
                }
                ServiceControl::Interrogate => ServiceControlHandlerResult::NoError,
                _ => ServiceControlHandlerResult::NotImplemented,
            }
        },
    )?;
    status_handle.set_service_status(ServiceStatus {
        service_type: ServiceType::OWN_PROCESS,
        current_state: ServiceState::Running,
        controls_accepted: ServiceControlAccept::STOP,
        exit_code: ServiceExitCode::Win32(0),
        checkpoint: 0,
        wait_hint: Duration::default(),
        process_id: None,
    })?;
    let runtime = tokio::runtime::Runtime::new().expect("Tokio runtime should start");
    let result = runtime.block_on(super::run_server(async move {
        let _ = shutdown_receiver.await;
    }));
    status_handle.set_service_status(ServiceStatus {
        service_type: ServiceType::OWN_PROCESS,
        current_state: ServiceState::Stopped,
        controls_accepted: ServiceControlAccept::empty(),
        exit_code: if result.is_ok() {
            ServiceExitCode::Win32(0)
        } else {
            ServiceExitCode::ServiceSpecific(1)
        },
        checkpoint: 0,
        wait_hint: Duration::default(),
        process_id: None,
    })?;
    Ok(())
}
