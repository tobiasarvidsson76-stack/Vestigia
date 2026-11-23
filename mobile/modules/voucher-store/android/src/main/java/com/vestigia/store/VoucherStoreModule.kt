package com.vestigia.store

import com.android.billingclient.api.BillingClient
import com.android.billingclient.api.BillingClientStateListener
import com.android.billingclient.api.BillingFlowParams
import com.android.billingclient.api.BillingResult
import com.android.billingclient.api.ConsumeParams
import com.android.billingclient.api.PendingPurchasesParams
import com.android.billingclient.api.ProductDetails
import com.android.billingclient.api.Purchase
import com.android.billingclient.api.QueryProductDetailsParams
import com.android.billingclient.api.QueryPurchasesParams
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.suspendCancellableCoroutine

class VoucherStoreModule : Module() {
  private val mutex = Mutex()
  private var client: BillingClient? = null

  private suspend fun connect(): BillingClient = mutex.withLock {
    val store = client ?: BillingClient.newBuilder(
      requireNotNull(appContext.reactContext) { "Store context is unavailable" }
    ).enablePendingPurchases(
      PendingPurchasesParams.newBuilder().enableOneTimeProducts().build()
    ).enableAutoServiceReconnection().setListener { result, purchases ->
      when (result.responseCode) {
        BillingClient.BillingResponseCode.OK -> purchases.orEmpty().forEach { purchase ->
          pack(purchase)?.let { sendEvent("onPurchase", it) }
        }
        BillingClient.BillingResponseCode.USER_CANCELED -> Unit
        else -> sendEvent("onStoreError", mapOf("message" to result.debugMessage))
      }
    }.build().also { client = it }
    if (!store.isReady) withTimeout(12000) {
      suspendCancellableCoroutine<Unit> { continuation ->
        store.startConnection(object : BillingClientStateListener {
          override fun onBillingServiceDisconnected() = Unit
          override fun onBillingSetupFinished(result: BillingResult) {
            if (!continuation.isActive) return
            if (result.responseCode == BillingClient.BillingResponseCode.OK) continuation.resume(Unit)
            else continuation.resumeWithException(IllegalStateException(result.debugMessage))
          }
        })
      }
    }
    store
  }

  private suspend fun details(store: BillingClient, sku: String): ProductDetails = withTimeout(12000) {
    suspendCancellableCoroutine { continuation ->
      val product = QueryProductDetailsParams.Product.newBuilder()
        .setProductId(sku).setProductType(BillingClient.ProductType.INAPP).build()
      val params = QueryProductDetailsParams.newBuilder().setProductList(listOf(product)).build()
      store.queryProductDetailsAsync(params) { result, products ->
        if (!continuation.isActive) return@queryProductDetailsAsync
        val item = products.productDetailsList.firstOrNull { it.productId == sku }
        if (result.responseCode == BillingClient.BillingResponseCode.OK && item != null) {
          continuation.resume(item)
        } else continuation.resumeWithException(IllegalStateException("Voucher pack is unavailable"))
      }
    }
  }

  private fun pack(purchase: Purchase): Map<String, String>? {
    val sku = purchase.products.singleOrNull() ?: return null
    if (purchase.purchaseState != Purchase.PurchaseState.PURCHASED) return null
    return mapOf("id" to purchase.purchaseToken, "receipt" to purchase.purchaseToken, "product" to sku)
  }

  override fun definition() = ModuleDefinition {
    Name("VestigiaVoucherStore")
    Events("onPurchase", "onStoreError")

    AsyncFunction("price") Coroutine { sku: String ->
      val product = details(connect(), sku)
      requireNotNull(product.oneTimePurchaseOfferDetails) { "Voucher price is unavailable" }.formattedPrice
    }

    AsyncFunction("buy") Coroutine { sku: String, account: String ->
      val store = connect()
      val product = details(store, sku)
      withContext(Dispatchers.Main) {
        val activity = requireNotNull(appContext.currentActivity) { "Open the app to buy vouchers" }
        val offer = requireNotNull(product.oneTimePurchaseOfferDetails) { "Voucher offer is unavailable" }
        val selected = BillingFlowParams.ProductDetailsParams.newBuilder().setProductDetails(product)
        offer.offerToken?.let { selected.setOfferToken(it) }
        val params = BillingFlowParams.newBuilder().setObfuscatedAccountId(account)
          .setProductDetailsParamsList(listOf(selected.build())).build()
        val result = store.launchBillingFlow(activity, params)
        check(result.responseCode == BillingClient.BillingResponseCode.OK) { result.debugMessage }
      }
    }

    AsyncFunction("unfinished") Coroutine { sku: String ->
      val store = connect()
      withTimeout(12000) {
        suspendCancellableCoroutine<List<Map<String, String>>> { continuation ->
          val params = QueryPurchasesParams.newBuilder().setProductType(BillingClient.ProductType.INAPP).build()
          store.queryPurchasesAsync(params) { result, purchases ->
            if (!continuation.isActive) return@queryPurchasesAsync
            if (result.responseCode == BillingClient.BillingResponseCode.OK) {
              continuation.resume(purchases.mapNotNull(::pack).filter { it["product"] == sku })
            } else continuation.resumeWithException(IllegalStateException(result.debugMessage))
          }
        }
      }
    }

    AsyncFunction("finish") Coroutine { id: String ->
      val store = connect()
      withTimeout(12000) {
        suspendCancellableCoroutine<Unit> { continuation ->
          val params = ConsumeParams.newBuilder().setPurchaseToken(id).build()
          store.consumeAsync(params) { result, _ ->
            if (!continuation.isActive) return@consumeAsync
            if (result.responseCode == BillingClient.BillingResponseCode.OK ||
                result.responseCode == BillingClient.BillingResponseCode.ITEM_NOT_OWNED) {
              continuation.resume(Unit)
            } else continuation.resumeWithException(IllegalStateException(result.debugMessage))
          }
        }
      }
    }

    OnDestroy {
      client?.endConnection()
      client = null
    }
  }
}
