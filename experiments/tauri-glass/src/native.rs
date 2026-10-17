// An isolated native-compositor probe, not a production material.
// HostBackdropBrush never exposes desktop pixels to JS or CPU memory.
use std::cell::RefCell;
use windows::core::{implement, Interface, Result, GUID, HSTRING, PCWSTR};
use windows::Foundation::{IPropertyValue, PropertyValue};
use windows::Graphics::Effects::{IGraphicsEffect, IGraphicsEffect_Impl, IGraphicsEffectSource, IGraphicsEffectSource_Impl};
use windows::System::DispatcherQueueController;
use windows::UI::Composition::{Compositor, CompositionEffectSourceParameter};
use windows::UI::Composition::Desktop::DesktopWindowTarget;
use windows::Win32::Foundation::{HWND,E_INVALIDARG,E_NOTIMPL};
use windows::Win32::Graphics::Direct2D::{CLSID_D2D12DAffineTransform,CLSID_D2D1ColorMatrix,CLSID_D2D1Composite};
use windows::Win32::Graphics::Dwm::{DwmSetWindowAttribute,DWMWA_USE_HOSTBACKDROPBRUSH};
use windows::Win32::System::WinRT::{CreateDispatcherQueueController,DispatcherQueueOptions,DQTYPE_THREAD_CURRENT,DQTAT_COM_STA};
use windows::Win32::System::WinRT::Composition::ICompositorDesktopInterop;
use windows::Win32::System::WinRT::Graphics::Direct2D::{IGraphicsEffectD2D1Interop,IGraphicsEffectD2D1Interop_Impl,GRAPHICS_EFFECT_PROPERTY_MAPPING};
use windows_numerics::Vector2;

#[implement(IGraphicsEffect,IGraphicsEffectSource,IGraphicsEffectD2D1Interop)]
struct Fx { id:GUID, properties:Vec<IPropertyValue>, sources:Vec<IGraphicsEffectSource> }
impl IGraphicsEffectSource_Impl for Fx_Impl {}
impl IGraphicsEffect_Impl for Fx_Impl {
    fn Name(&self)->Result<HSTRING>{Ok(HSTRING::new())}
    fn SetName(&self,_:&HSTRING)->Result<()>{Ok(())}
}
impl IGraphicsEffectD2D1Interop_Impl for Fx_Impl {
    fn GetEffectId(&self)->Result<GUID>{Ok(self.id)}
    fn GetNamedPropertyMapping(&self,_:&PCWSTR,_:*mut u32,_:*mut GRAPHICS_EFFECT_PROPERTY_MAPPING)->Result<()>{Err(E_NOTIMPL.into())}
    fn GetPropertyCount(&self)->Result<u32>{Ok(self.properties.len() as u32)}
    fn GetProperty(&self,i:u32)->Result<IPropertyValue>{self.properties.get(i as usize).cloned().ok_or(E_INVALIDARG.into())}
    fn GetSourceCount(&self)->Result<u32>{Ok(self.sources.len() as u32)}
    fn GetSource(&self,i:u32)->Result<IGraphicsEffectSource>{self.sources.get(i as usize).cloned().ok_or(E_INVALIDARG.into())}
}
fn fx(id:GUID,properties:Vec<IPropertyValue>,sources:Vec<IGraphicsEffectSource>)->IGraphicsEffectSource {Fx{id,properties,sources}.into()}
fn uint(v:u32)->Result<IPropertyValue>{PropertyValue::CreateUInt32(v)?.cast()}
fn array(v:&[f32])->Result<IPropertyValue>{PropertyValue::CreateSingleArray(v)?.cast()}
struct Scene { _queue:DispatcherQueueController,_target:DesktopWindowTarget,_compositor:Compositor }
thread_local! {static SCENE:RefCell<Option<Scene>>=const{RefCell::new(None)};}

pub fn attach(hwnd:HWND,width:f32,height:f32,radius:f32,disperse:bool)->Result<()> {
    let queue=unsafe{CreateDispatcherQueueController(DispatcherQueueOptions{dwSize:std::mem::size_of::<DispatcherQueueOptions>() as u32,threadType:DQTYPE_THREAD_CURRENT,apartmentType:DQTAT_COM_STA})?};
    let compositor=Compositor::new()?;
    let enabled=1i32;
    unsafe{DwmSetWindowAttribute(hwnd,DWMWA_USE_HOSTBACKDROPBRUSH,&enabled as *const _ as _,4)?;}
    let interop:ICompositorDesktopInterop=compositor.cast()?;
    let target=unsafe{interop.CreateDesktopWindowTarget(hwnd,false)?};
    let mut channels=Vec::new();
    for channel in 0..3 {
        // Composition forbids reusing one transformed source parameter in
        // different branches. Bind a distinct source for each channel.
        let source:IGraphicsEffectSource=CompositionEffectSourceParameter::Create(&HSTRING::from(format!("Desktop{channel}")))?.cast()?;
        // First prove real channel-dependent desktop displacement. A single
        // affine lens is not the reference project's spatial SDF lens.
        let scale=if disperse {1.045+channel as f32*0.012} else {1.0};
        let transform=fx(CLSID_D2D12DAffineTransform,vec![uint(1)?,uint(1)?,array(&[scale,0.,0.,scale,width*(1.-scale)*0.5,height*(1.-scale)*0.5])?,PropertyValue::CreateSingle(0.)?.cast()?],vec![source.clone()]);
        let mut matrix=[0f32;20];matrix[channel*5]=1.;matrix[15]=1.;
        channels.push(fx(CLSID_D2D1ColorMatrix,vec![array(&matrix)?,uint(1)?,PropertyValue::CreateBoolean(false)?.cast()?],vec![transform]));
    }
    // Add RGB channels rather than screen blending tinted copies.
    let graph:IGraphicsEffect=fx(CLSID_D2D1Composite,vec![uint(9)?],channels).cast()?;
    let factory=compositor.CreateEffectFactory(&graph)?;
    let brush=factory.CreateBrush()?;
    for channel in 0..3 {
        brush.SetSourceParameter(&HSTRING::from(format!("Desktop{channel}")),&compositor.CreateHostBackdropBrush()?)?;
    }
    let visual=compositor.CreateSpriteVisual()?;
    visual.SetSize(Vector2{X:width,Y:height})?;
    visual.SetBrush(&brush)?;
    let round=compositor.CreateRoundedRectangleGeometry()?;
    round.SetSize(Vector2{X:width,Y:height})?;
    round.SetCornerRadius(Vector2{X:radius,Y:radius})?;
    visual.SetClip(&compositor.CreateGeometricClipWithGeometry(&round)?)?;
    target.SetRoot(&visual)?;
    SCENE.with(|s|*s.borrow_mut()=Some(Scene{_queue:queue,_target:target,_compositor:compositor}));
    Ok(())
}
