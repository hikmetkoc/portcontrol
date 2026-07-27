#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    portcontrol_lib::run();
}
