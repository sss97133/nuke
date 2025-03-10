import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { VehicleAuctionEscrow } from "../typechain-types";

describe("VehicleAuctionEscrow", function () {
  let escrow: VehicleAuctionEscrow;
  let owner: SignerWithAddress;
  let bidder1: SignerWithAddress;
  let bidder2: SignerWithAddress;
  let seller: SignerWithAddress;

  const AUCTION_ID = 1;
  const BID_AMOUNT = ethers.utils.parseEther("1.0");
  const MINIMUM_DEPOSIT = ethers.utils.parseEther("0.01");

  beforeEach(async function () {
    [owner, bidder1, bidder2, seller] = await ethers.getSigners();

    const EscrowFactory = await ethers.getContractFactory("VehicleAuctionEscrow");
    escrow = await EscrowFactory.deploy();
    await escrow.deployed();
  });

  describe("Deposits", function () {
    it("Should accept deposits above minimum", async function () {
      await expect(escrow.connect(bidder1).deposit({ value: MINIMUM_DEPOSIT }))
        .to.emit(escrow, "Deposited")
        .withArgs(bidder1.address, MINIMUM_DEPOSIT);

      const balance = await escrow.getBalance(bidder1.address);
      expect(balance).to.equal(MINIMUM_DEPOSIT);
    });

    it("Should reject deposits below minimum", async function () {
      await expect(
        escrow.connect(bidder1).deposit({ value: ethers.utils.parseEther("0.009") })
      ).to.be.revertedWith("Deposit below minimum");
    });
  });

  describe("Withdrawals", function () {
    beforeEach(async function () {
      await escrow.connect(bidder1).deposit({ value: BID_AMOUNT });
    });

    it("Should allow withdrawal of available funds", async function () {
      await expect(escrow.connect(bidder1).withdraw(MINIMUM_DEPOSIT))
        .to.emit(escrow, "Withdrawn")
        .withArgs(bidder1.address, MINIMUM_DEPOSIT);

      const balance = await escrow.getBalance(bidder1.address);
      expect(balance).to.equal(BID_AMOUNT.sub(MINIMUM_DEPOSIT));
    });

    it("Should prevent withdrawal of more than balance", async function () {
      const tooMuch = BID_AMOUNT.add(ethers.utils.parseEther("1.0"));
      await expect(
        escrow.connect(bidder1).withdraw(tooMuch)
      ).to.be.revertedWith("Insufficient balance");
    });
  });

  describe("Bid Locking", function () {
    beforeEach(async function () {
      await escrow.connect(bidder1).deposit({ value: BID_AMOUNT });
    });

    it("Should lock bid amount", async function () {
      await expect(escrow.connect(bidder1).lockBidAmount(AUCTION_ID))
        .to.emit(escrow, "BidLocked")
        .withArgs(bidder1.address, AUCTION_ID, BID_AMOUNT);

      const lockedAmount = await escrow.getLockedAmount(bidder1.address, AUCTION_ID);
      expect(lockedAmount).to.equal(BID_AMOUNT);
    });

    it("Should prevent double-locking bids", async function () {
      await escrow.connect(bidder1).lockBidAmount(AUCTION_ID);
      await expect(
        escrow.connect(bidder1).lockBidAmount(AUCTION_ID)
      ).to.be.revertedWith("Bid already locked");
    });
  });

  describe("Auction Completion", function () {
    beforeEach(async function () {
      await escrow.connect(bidder1).deposit({ value: BID_AMOUNT });
      await escrow.connect(bidder1).lockBidAmount(AUCTION_ID);
    });

    it("Should complete auction and transfer funds", async function () {
      const initialBalance = await ethers.provider.getBalance(seller.address);

      await expect(
        escrow.connect(owner).completeAuction(AUCTION_ID, bidder1.address, seller.address)
      )
        .to.emit(escrow, "AuctionCompleted")
        .withArgs(AUCTION_ID, bidder1.address, BID_AMOUNT);

      const finalBalance = await ethers.provider.getBalance(seller.address);
      expect(finalBalance.sub(initialBalance)).to.equal(BID_AMOUNT);
    });

    it("Should only allow owner to complete auction", async function () {
      await expect(
        escrow.connect(bidder2).completeAuction(AUCTION_ID, bidder1.address, seller.address)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });
  });

  describe("Emergency Functions", function () {
    beforeEach(async function () {
      await escrow.connect(bidder1).deposit({ value: BID_AMOUNT });
    });

    it("Should allow owner to emergency withdraw", async function () {
      const initialBalance = await ethers.provider.getBalance(bidder1.address);

      await expect(escrow.connect(owner).emergencyWithdraw(bidder1.address))
        .to.emit(escrow, "EmergencyWithdraw")
        .withArgs(bidder1.address, BID_AMOUNT);

      const finalBalance = await ethers.provider.getBalance(bidder1.address);
      expect(finalBalance.sub(initialBalance)).to.equal(BID_AMOUNT);
    });

    it("Should prevent non-owners from emergency withdraw", async function () {
      await expect(
        escrow.connect(bidder2).emergencyWithdraw(bidder1.address)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });
  });
});
