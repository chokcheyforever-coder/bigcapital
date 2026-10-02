import { OpenExchangeRate } from './OpenExchangeRate';
import { MefCambodiaExchangeRate } from './MefCambodiaExchangeRate';
import { ExchangeRateServiceType, IExchangeRateService } from './types';

export class ExchangeRate {
  private exchangeRateService: IExchangeRateService;
  private exchangeRateServiceType: ExchangeRateServiceType;

  /**
   * Constructor method.
   * @param {ExchangeRateServiceType} service
   */
  constructor(service: ExchangeRateServiceType) {
    this.exchangeRateServiceType = service;
    this.initService();
  }

  /**
   * Initialize the exchange rate service based on the service type.
   */
  private initService() {
    if (
      this.exchangeRateServiceType === ExchangeRateServiceType.OpenExchangeRate
    ) {
      this.setExchangeRateService(new OpenExchangeRate());
    } else if (
      this.exchangeRateServiceType === ExchangeRateServiceType.MefCambodia
    ) {
      // Currencies the NBC doesn't publish go to Open Exchange Rates when
      // it has a key.
      const fallback = process.env.OPEN_EXCHANGE_RATE_APP_ID
        ? new OpenExchangeRate()
        : undefined;
      this.setExchangeRateService(new MefCambodiaExchangeRate(fallback));
    }
  }

  /**
   * Sets the exchange rate service.
   * @param {IExchangeRateService} service
   */
  private setExchangeRateService(service: IExchangeRateService) {
    this.exchangeRateService = service;
  }

  /**
   * Gets the latest exchange rate.
   * @param {string} baseCurrency
   * @param {string} toCurrency
   * @returns {number}
   */
  public latest(baseCurrency: string, toCurrency: string): Promise<number> {
    return this.exchangeRateService.latest(baseCurrency, toCurrency);
  }
}
