param([string]$StatePath, [string]$ActionPath, [int]$OwnerPid)

Add-Type -AssemblyName PresentationFramework, PresentationCore, WindowsBase

function New-StartupWindow {
  param([string]$StatePath, [string]$ActionPath, [int]$OwnerPid)
  [xml]$markup = @'
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        Title="DSH Status Bar · 准备悬浮窗" Width="456" Height="262"
        ResizeMode="NoResize" WindowStartupLocation="CenterScreen" Background="#F7F9FC"
        FontFamily="Microsoft YaHei UI" FontSize="13" ShowInTaskbar="True">
  <Grid Margin="24,20,24,18">
    <Grid.RowDefinitions><RowDefinition Height="Auto"/><RowDefinition Height="Auto"/><RowDefinition Height="Auto"/><RowDefinition Height="*"/><RowDefinition Height="Auto"/></Grid.RowDefinitions>
    <TextBlock Name="Heading" Text="正在准备悬浮窗" FontSize="20" FontWeight="SemiBold" Foreground="#14263E"/>
    <TextBlock Grid.Row="1" Name="Message" Text="首次启动需要下载桌面运行时。完成后会自动打开。" TextWrapping="Wrap" Foreground="#44566D" Margin="0,12,0,14"/>
    <ProgressBar Grid.Row="2" Name="Progress" Height="6" Minimum="0" Maximum="100" Foreground="#426DDD" Background="#E2E8F0" BorderThickness="0" IsIndeterminate="True"/>
    <TextBlock Grid.Row="3" Name="Detail" Text="连接中…" Foreground="#52657C" Margin="0,10,0,8" TextWrapping="Wrap"/>
    <StackPanel Grid.Row="4" Orientation="Horizontal" HorizontalAlignment="Right">
      <Button Name="Retry" Content="重试" Width="90" Height="30" Margin="0,0,10,0" Visibility="Collapsed" Background="#E6EDFF" Foreground="#244BB5"/>
      <Button Name="Cancel" Content="取消" Width="90" Height="30" Background="#EDF0F5" Foreground="#283C54"/>
    </StackPanel>
  </Grid>
</Window>
'@
  $reader = New-Object System.Xml.XmlNodeReader $markup
  $window = [Windows.Markup.XamlReader]::Load($reader)
  $model = @{ Window=$window; Retry=$window.FindName('Retry'); Cancel=$window.FindName('Cancel'); Finished=$false; CommandSent=$false }
  $sendAction = {
    param([string]$action)
    [IO.File]::WriteAllText($ActionPath, $action, (New-Object Text.UTF8Encoding $false))
    $model.CommandSent = $true
  }.GetNewClosure()
  $retryClick = {
    & $sendAction 'retry'
    $model.Retry.IsEnabled = $false
    $window.FindName('Message').Text = '正在重新连接；可验证的已下载部分会继续使用。'
  }.GetNewClosure()
  $model.Retry.Add_Click($retryClick)
  $cancelClick = { & $sendAction 'cancel'; $window.Close() }.GetNewClosure()
  $model.Cancel.Add_Click($cancelClick)
  $timer = New-Object Windows.Threading.DispatcherTimer
  $timer.Interval = [TimeSpan]::FromMilliseconds(300)
  $tick = {
    try { $null = Get-Process -Id $OwnerPid -ErrorAction Stop }
    catch { $model.Finished=$true; $window.Close(); return }
    try {
      $state = [IO.File]::ReadAllText($StatePath) | ConvertFrom-Json -ErrorAction Stop
      $failed = $state.phase -eq 'failed'
      $window.FindName('Heading').Text = $(if($failed){'悬浮窗暂未启动'}else{'正在准备悬浮窗'})
      $window.FindName('Message').Text = [string]$state.message
      $model.Retry.Visibility = $(if($failed){'Visible'}else{'Collapsed'})
      $model.Retry.IsEnabled = $failed
      $model.Cancel.Content = $(if($failed){'稍后再试'}else{'取消'})
      $bar = $window.FindName('Progress')
      $bar.IsIndeterminate = -not $failed -and ($state.phase -ne 'downloading' -or -not $state.total)
      if($state.total){ $bar.Value=[Math]::Min(100, 100 * [double]$state.received / [double]$state.total) }
      $window.FindName('Detail').Text = $(if($failed){'点击重试即可继续，无需重启 DSH。'}elseif($state.phase -eq 'unpacking'){'正在校验和解压，请稍候。'}elseif($state.total){'{0:N1} / {1:N1} MB  ·  仅本版本首次需要' -f ($state.received/1MB),($state.total/1MB)}else{'请保持 DSH 运行；可随时取消，下次继续。'})
    } catch { # A writer can briefly hold the file. Retry on the next tick.
    }
  }.GetNewClosure()
  $timer.Add_Tick($tick)
  $closing = {
    $timer.Stop()
    if(-not $model.Finished -and -not $model.CommandSent){ & $sendAction 'cancel' }
  }.GetNewClosure()
  $window.Add_Closed($closing)
  $timer.Start()
  $model.Tick=$tick
  return $model
}

if($MyInvocation.InvocationName -ne '.') {
  $ui = New-StartupWindow -StatePath $StatePath -ActionPath $ActionPath -OwnerPid $OwnerPid
  $null = $ui.Window.ShowDialog()
}
