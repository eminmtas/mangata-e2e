/*
 *
 * @group 3rdPartyRewards
 */
import { getApi, initApi } from "../../utils/api";
import { User } from "../../utils/User";
import { Keyring } from "@polkadot/api";
import { BN } from "@polkadot/util";
import {
  getEnvironmentRequiredVars,
  getThirdPartyRewards,
  getUserBalanceOfToken,
} from "../../utils/utils";
import { Assets } from "../../utils/Assets";
import { Sudo } from "../../utils/sudo";
import { Xyk } from "../../utils/xyk";
import { setupApi, setupUsers } from "../../utils/setup";
import { MGA_ASSET_ID } from "../../utils/Constants";
import { BN_MILLION, BN_ZERO, signTx } from "@mangata-finance/sdk";
import { ProofOfStake } from "../../utils/ProofOfStake";
import { getLiquidityAssetId } from "../../utils/tx";
import { getEventResultFromMangataTx } from "../../utils/txHandler";
import { ExtrinsicResult, waitForRewards } from "../../utils/eventListeners";
import { testLog } from "../../utils/Logger";

let testUser1: User;
let testUser2: User;
let testUser3: User;
let sudo: User;

let keyring: Keyring;
let newToken: BN;

describe("Proof of stake tests", () => {
  beforeAll(async () => {
    try {
      getApi();
    } catch (e) {
      await initApi();
    }

    keyring = new Keyring({ type: "sr25519" });
    sudo = new User(keyring, getEnvironmentRequiredVars().sudo);
    [testUser1, testUser2, testUser3] = setupUsers();
    newToken = await Assets.issueAssetToUser(
      sudo,
      Assets.DEFAULT_AMOUNT,
      sudo,
      true,
    );

    await setupApi();
    await Sudo.batchAsSudoFinalized(
      Assets.FinalizeTge(),
      Assets.initIssuance(),
      Assets.mintToken(newToken, testUser1, Assets.DEFAULT_AMOUNT.muln(40e6)),
      Assets.mintToken(newToken, testUser1, Assets.DEFAULT_AMOUNT.muln(40e6)),
      Assets.mintToken(newToken, testUser2, Assets.DEFAULT_AMOUNT),
      Assets.mintToken(newToken, testUser3, Assets.DEFAULT_AMOUNT),
      Assets.mintNative(testUser1, Assets.DEFAULT_AMOUNT.muln(40e6).muln(2)),
      Assets.mintNative(testUser2),
      Assets.mintNative(testUser3),
      Sudo.sudoAs(
        testUser1,
        Xyk.createPool(
          MGA_ASSET_ID,
          Assets.DEFAULT_AMOUNT.muln(20e6),
          newToken,
          Assets.DEFAULT_AMOUNT.muln(20e6),
        ),
      ),
    );
    const liqId = await getLiquidityAssetId(MGA_ASSET_ID, newToken);
    await Sudo.batchAsSudoFinalized(
      Sudo.sudoAs(
        testUser2,
        Xyk.mintLiquidity(
          MGA_ASSET_ID,
          newToken,
          Assets.DEFAULT_AMOUNT.divn(2),
          Assets.DEFAULT_AMOUNT,
        ),
      ),
      Sudo.sudoAs(
        testUser3,
        Xyk.mintLiquidity(
          MGA_ASSET_ID,
          newToken,
          Assets.DEFAULT_AMOUNT.divn(2),
          Assets.DEFAULT_AMOUNT,
        ),
      ),
      Sudo.sudoAs(
        testUser1,
        await ProofOfStake.rewardPool(
          MGA_ASSET_ID,
          newToken,
          newToken,
          Assets.DEFAULT_AMOUNT.muln(10e6),
          3,
        ),
      ),
      Sudo.sudoAs(
        testUser1,
        await ProofOfStake.rewardPool(
          MGA_ASSET_ID,
          newToken,
          newToken,
          Assets.DEFAULT_AMOUNT.muln(10e6),
          3,
        ),
      ),
      Sudo.sudoAs(
        testUser1,
        await ProofOfStake.activateLiquidityFor3rdpartyRewards(
          liqId,
          Assets.DEFAULT_AMOUNT.divn(10),
          newToken,
        ),
      ),
      Sudo.sudoAs(
        testUser1,
        await ProofOfStake.rewardPool(
          MGA_ASSET_ID,
          newToken,
          newToken,
          Assets.DEFAULT_AMOUNT.muln(10e6),
          3,
        ),
      ),
    );
  });

  describe("Happy path", () => {
    test("A user can deactivate all the tokens when partial activation / deactivation", async () => {
      const liqId = await getLiquidityAssetId(MGA_ASSET_ID, newToken);
      testLog.getLog().warn("liqId: " + liqId.toString());
      await waitForRewards(testUser1, liqId, 20, newToken);
      await signTx(
        getApi(),
        await ProofOfStake.deactivateLiquidityFor3rdpartyRewards(
          liqId,
          BN_MILLION,
          newToken,
        ),
        testUser1.keyRingPair,
      ).then((events) => {
        expect(getEventResultFromMangataTx(events).state).toBe(
          ExtrinsicResult.ExtrinsicSuccess,
        );
      });
      await signTx(
        getApi(),
        await ProofOfStake.activateLiquidityFor3rdpartyRewards(
          liqId,
          BN_MILLION,
          newToken,
        ),
        testUser1.keyRingPair,
      ).then((events) => {
        expect(getEventResultFromMangataTx(events).state).toBe(
          ExtrinsicResult.ExtrinsicSuccess,
        );
      });
      const amountToDeactivate =
        await ProofOfStake.activatedLiquidityForSchedules(
          liqId,
          testUser1.keyRingPair.address,
          newToken,
        );
      await waitForRewards(testUser1, liqId, 20, newToken);
      await waitForRewards(testUser1, liqId, 20, newToken);

      await signTx(
        getApi(),
        await ProofOfStake.deactivateLiquidityFor3rdpartyRewards(
          liqId,
          amountToDeactivate,
          newToken,
        ),
        testUser1.keyRingPair,
      ).then((events) => {
        expect(getEventResultFromMangataTx(events).state).toBe(
          ExtrinsicResult.ExtrinsicSuccess,
        );
      });
      const userBalance = await getUserBalanceOfToken(liqId, testUser1);
      expect(userBalance.reserved).bnEqual(BN_ZERO);
      expect(userBalance.frozen).bnEqual(BN_ZERO);
      const userBalanceBefore = await getUserBalanceOfToken(
        newToken,
        testUser1,
      );
      const rewards = await getThirdPartyRewards(
        testUser1.keyRingPair.address,
        liqId,
        newToken,
      );
      await signTx(
        getApi(),
        await ProofOfStake.claim3rdpartyRewards(liqId, newToken),
        testUser1.keyRingPair,
      ).then((events) => {
        expect(getEventResultFromMangataTx(events).state).toBe(
          ExtrinsicResult.ExtrinsicSuccess,
        );
        const claimEvent = getEventResultFromMangataTx(events, [
          "ThirdPartyRewardsClaimed",
        ]);
        expect(claimEvent.data[0]).toEqual(testUser1.keyRingPair.address);
        expect(claimEvent.data[1]).toEqual(liqId.toString());
        expect(claimEvent.data[2]).toEqual(newToken.toString());
        expect(claimEvent.data[3].replaceAll(",", "")).toEqual(
          rewards.toString(),
        );
      });
      const userBalanceAfter = await getUserBalanceOfToken(newToken, testUser1);
      expect(userBalanceAfter.free.sub(userBalanceBefore.free)).bnEqual(
        rewards,
      );
    });
  });
});
