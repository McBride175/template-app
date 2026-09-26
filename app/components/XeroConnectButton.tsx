import { actionStyles } from './ui/actionStyles'

export default function XeroConnectButton() {
  return (
    <a
      href="/api/xero/connect?returnTo=%2Fdashboard"
      className={actionStyles({ variant: 'secondary' })}
    >
      Connect Xero
    </a>
  )
}
