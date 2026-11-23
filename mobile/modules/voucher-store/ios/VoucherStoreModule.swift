import ExpoModulesCore
import StoreKit

public final class VoucherStoreModule: Module {
  private var updates: Task<Void, Never>?

  private func purchaseInfo(_ result: VerificationResult<Transaction>) -> [String: String]? {
    guard case .verified(let transaction) = result else { return nil }
    return ["id": String(transaction.id), "receipt": result.jwsRepresentation, "product": transaction.productID]
  }

  public func definition() -> ModuleDefinition {
    Name("VestigiaVoucherStore")
    Events("onPurchase", "onStoreError")

    OnCreate { [weak self] in
      self?.updates = Task { [weak self] in
        for await result in Transaction.updates {
          if let info = self?.purchaseInfo(result) {
            self?.sendEvent("onPurchase", info)
          }
        }
      }
    }

    OnDestroy { [weak self] in self?.updates?.cancel() }

    AsyncFunction("price") { (sku: String, promise: Promise) in
      Task {
        do {
          guard let product = try await Product.products(for: [sku]).first else {
            promise.reject("E_STORE", "Voucher pack is unavailable")
            return
          }
          promise.resolve(product.displayPrice)
        } catch { promise.reject("E_STORE", error.localizedDescription) }
      }
    }

    AsyncFunction("buy") { (sku: String, account: String, promise: Promise) in
      Task { @MainActor in
        do {
          guard let token = UUID(uuidString: account),
                let product = try await Product.products(for: [sku]).first else {
            promise.reject("E_STORE", "Voucher pack is unavailable")
            return
          }
          let outcome = try await product.purchase(options: [.appAccountToken(token)])
          if case .success(let result) = outcome {
            guard let info = self.purchaseInfo(result) else {
              promise.reject("E_STORE", "The App Store could not verify the transaction")
              return
            }
            self.sendEvent("onPurchase", info)
          }
          promise.resolve(nil)
        } catch { promise.reject("E_STORE", error.localizedDescription) }
      }
    }

    AsyncFunction("unfinished") { (sku: String, promise: Promise) in
      Task {
        var purchases: [[String: String]] = []
        for await result in Transaction.unfinished {
          if let info = self.purchaseInfo(result), info["product"] == sku {
            purchases.append(info)
          }
        }
        promise.resolve(purchases)
      }
    }

    AsyncFunction("finish") { (id: String, promise: Promise) in
      Task {
        for await result in Transaction.unfinished {
          if case .verified(let transaction) = result, String(transaction.id) == id {
            await transaction.finish()
            break
          }
        }
        promise.resolve(nil)
      }
    }
  }
}
